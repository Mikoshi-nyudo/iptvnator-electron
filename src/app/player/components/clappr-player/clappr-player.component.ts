import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  AfterViewInit,
  SimpleChanges,
  ViewEncapsulation
} from '@angular/core';
import { Channel } from '../../../../../shared/channel.interface';

declare const Clappr: any;
declare const HlsjsPlayback: any;
declare const DashShakaPlayback: any;
declare const LevelSelector: any;
declare const ClapprStats: any;
declare const ClapprNerdStats: any;

@Component({
  selector: 'app-clappr-player',
  templateUrl: './clappr-player.component.html',
  styleUrls: ['./clappr-player.component.scss'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
})

export class ClapprPlayerComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('clapprplayer', { static: true }) clapprplayer: ElementRef;
  @Input() channel: Channel;

  private player: any;
  private options = {};
  private debounce: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private isPlayerDestroying = false;

  constructor() { }

  ngOnInit(): void { }

  ngAfterViewInit(): void {
    this.initializePlayer();
  }

  destroyPlayer(): void {
    if (this.player) {
      console.log('Destroying Clappr player...');
      this.isPlayerDestroying = true;
      if (this.debounce) {
        clearTimeout(this.debounce);
        this.debounce = null;
      }
      this.player.destroy();
      this.player = null;
      this.isPlayerDestroying = false;
      this.retryCount = 0;
    }
  }

  ngOnDestroy(): void {
    this.destroyPlayer();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.channel && changes.channel.currentValue) {
      // Reinitialize the player if the channel changes
      if (this.player) {
        this.destroyPlayer();
        this.initializePlayer();
      }
    }
  }

  setupPlayerEvents(): void {
    const maxRetries = 4;
    const retryDelay = 5000;

    const retryPlayback = () => {
        if (this.retryCount >= maxRetries) {
            console.error("Maximum retries reached. Playback failed.");
            return;
        }

        this.retryCount++;
        console.log(`Retrying playback (${this.retryCount}/${maxRetries})...`);

        if (this.debounce) {
            clearTimeout(this.debounce);
        }

        this.debounce = setTimeout(() => {
            if (this.player) {
              this.player.configure(this.player.options)
            }
        }, retryDelay);
    };

    [Clappr.Events.PLAYER_ERROR, Clappr.Events.MEDIA_ERROR, Clappr.Events.NETWORK_ERROR].forEach((event) => {
        this.player.on(event, (error?: any) => {
          console.error(`Clappr ${event}:`, error);
          retryPlayback();
        });
    });
}

  initializePlayer(): void {
    if (!this.channel?.url) {
      console.error('Cannot initialize player: no URL provided');
      return;
    }

    try {
      // Configure ClearKey DRM
      const shakaConfig = {
        preferredTextLanguage: 'en-US',
        streaming: {
          lowLatencyMode: true,
          inaccurateManifestTolerance: 0,
          rebufferingGoal: 0.01,
          segmentPrefetchLimit: 2,
          updateIntervalSeconds: 0.1,
          maxDisabledTime: 1,
          retryParameters: {
            baseDelay: 100,
            maxAttempts: 990,
            timeout: 0
          },
        },
        manifest: {
          dash: {
            autoCorrectDrift: true,
          },
          retryParameters: {
            baseDelay: 100,
            maxAttempts: 990,
            timeout: 0
          },
        },
        abr: {
          enabled: false
        }
      } as any;

      const hlsConfig = {
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 9000,
            maxLoadTimeMs: 100000,
            timeoutRetry: {
              maxNumRetry: 9999,
              retryDelayMs: 1000,
              maxRetryDelayMs: 0,
            },
            errorRetry: {
              maxNumRetry: 999,
              retryDelayMs: 1000,
              maxRetryDelayMs: 15000,
              backoff: 'linear',
            },
          },
        },
        subtitlePreference: {
          lang: 'en-US',
        },
      };

      this.options = {
        source: this.channel.url,
        parent: this.clapprplayer.nativeElement,
        plugins: [LevelSelector, HlsjsPlayback, DashShakaPlayback, ClapprNerdStats, ClapprStats, Clappr.MediaControl],
        hlsUseNextLevel: false,
        hlsMinimumDvrSize: 60,
        hlsRecoverAttempts: 99,
        autoPlay: true,
        mute: false,
        width: '100%',
        height: '100%',
        hlsPlayback: {
          preload: true,
          customListeners: [],
        },
        playback: {
          extrapolatedWindowNumSegments: 2,
          triggerFatalErrorOnResourceDenied: false,
          hlsjsConfig: hlsConfig,
        },
        mediacontrol: {
          seekbar: "#62825D",
          buttons: "#526E48"
        },
        clapprNerdStats: {
          iconPosition: 'top-right'
        }
      }

      const { kid, key, clearKeys } = this.getDrmInfo(this.channel);

      if (clearKeys) {
        shakaConfig.drm = {
            clearKeys: clearKeys
        };
        this.options = {
          ...this.options,
          shakaConfiguration: shakaConfig,
          mimeType: 'application/dash+xml',
        };
      } else if (kid && key) {
          shakaConfig.drm = {
              clearKeys: {
                  [kid]: key
              }
          };
          this.options = {
            ...this.options,
            shakaConfiguration: shakaConfig,
            mimeType: 'application/dash+xml',
        };
      }
      
      this.player = new Clappr.Player(this.options);

      this.player.on(Clappr.Events.PLAYER_READY, () => {
        console.log('Clappr player is ready');
      });

      this.player.on(Clappr.Events.PLAYER_PLAY, () => {
        console.log('Clappr Player: Video is playing');
      });

      this.setupPlayerEvents();

    } catch (error) {
      console.error('Failed to initialize Clappr player:', error);
      this.destroyPlayer();
    }
  }

  getDrmInfo(channel: Channel) {
    const licenseKey = (channel.kodiprop['inputstream.adaptive.license_key'] as string);
    const licenseType = (channel.kodiprop['inputstream.adaptive.license_type'] as string);

    if (licenseKey && licenseType && licenseType.includes('clearkey')) {
        if (licenseKey.includes('{')) {
          try {
              const clearKeys = JSON.parse(licenseKey);
              return { 
                  kid: null,
                  key: null,
                  clearKeys
              };
          } catch (error) {
              console.error('Failed to parse JSON clearkey:', error);
          }
        }
        
        const [kid, key] = licenseKey.split(":");
        return { kid, key, clearKeys: null };
    }

    return { kid: null, key: null, clearKeys: null };
  }
}