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
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import ArtPlayer from 'artplayer';
import artplayerPluginHlsControl from 'artplayer-plugin-hls-control'
import artplayerPluginDashControl from 'artplayer-plugin-dash-control';
import Hls from 'hls.js';
declare const shaka: any;
declare const mpegts: any;

@Component({
  selector: 'app-art-player',
  templateUrl: './art-player.component.html',
  styleUrls: ['./art-player.component.scss'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
})

export class ArtPlayerComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('artplayer', { static: true }) artplayer: ElementRef;
  @Input() channel: Channel;

  artPlayerSnackBarOptions: MatSnackBarConfig = {
    verticalPosition: 'bottom',
    horizontalPosition: 'start',
    panelClass: 'custom-snackbar',
  };

  private player: ArtPlayer;

  private options: any;

  constructor(
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.initializePlayer();
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

  private destroyPlayer(): void {
    if (this.player) {
      console.log('Destroying art player...');
      this.player.destroy();
      this.player = null;
    }
  }

  ngOnDestroy(): void {
    this.destroyPlayer();
  }

  private playM3u8(video: HTMLVideoElement, url: string, art: any): void {
    if (Hls.isSupported()) {
      if (art.hls) art.hls.destroy();
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      art.hls = hls;
      art.on('destroy', () => hls.destroy());
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      art.notice.show = 'Unsupported playback format: m3u8';
    }
  }

  private playFlv(video: HTMLVideoElement, url: string, art: any): void {
    if (mpegts.isSupported()) {
      if (art.flv) art.flv.destroy();
  
      const flv = mpegts.createPlayer({
        type: 'mpegts',  // or 'flv' depending on your stream
        url: url,
        isLive: true,
        hasAudio: true,
        hasVideo: true,
        cors: true
      });

      flv.attachMediaElement(video);
      flv.load();
      flv.play();
  
      art.flv = flv;
      art.on('destroy', () => flv.destroy());
    } else {
      art.notice.show = 'Unsupported playback format: flv';
    }
  }

  private playMpd(video: HTMLVideoElement, url: string, art: any, kid?: string, key?: string, clearKeys?: any): void {
    const player = new shaka.Player(video);

    player.configure('streaming.failureCallback', (error) => {
      const retryErrorCodes = [
        shaka.util.Error.Code.BAD_HTTP_STATUS,
        shaka.util.Error.Code.HTTP_ERROR,
        shaka.util.Error.Code.TIMEOUT,
        shaka.util.Error.Code.NETWORK_ERROR,
      ];

      console.log('Streaming error:', error.code, error);

      // Check for 404 first
      if (error.code === shaka.util.Error.Code.BAD_HTTP_STATUS && 
          error.data && error.data[1] === 404) {
        
        // For VOD content, we want to stop
        if (!player.isLive()) {
          error.severity = shaka.util.Error.Severity.CRITICAL;
          return;
        }
      }

      // For live streams, retry on network errors
      if (player.isLive() && retryErrorCodes.includes(error.code)) {
        error.severity = shaka.util.Error.Severity.RECOVERABLE;
        console.log('Live streaming error. Retrying automatically...');
        player.retryStreaming();
      } else {
        // Make other errors recoverable by default
        error.severity = shaka.util.Error.Severity.RECOVERABLE;
      }
    });

    // Listen for error events.
    player.addEventListener('error', (event) => {
      const error = event.detail;
      console.error('Player error:', error);
    });
    
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
          maxAttempts: 999,
          timeout: 0
        },
      },
      manifest: {
        dash: {
          autoCorrectDrift: true,
        },
        retryParameters: {
          baseDelay: 100,
          maxAttempts: 999,
          timeout: 0
        },
      },
    } as any;


    if (clearKeys) {
      shakaConfig.drm = {
        retryParameters: {
          baseDelay: 100,
          maxAttempts: 999,
          timeout: 0
        },
        clearKeys: clearKeys
      };
    } else if (kid && key) {
      shakaConfig.drm = {
        retryParameters: {
          baseDelay: 100,
          maxAttempts: 999,
          timeout: 0
        },
        clearKeys: {
            [kid]: key
        }
      };
    }

    // Apply all configurations at once
    player.configure(shakaConfig);

    player.load(url).then(() => {
      console.log('The video has now been loaded!');
    }).catch((error) => {
      console.error('Error code', error.code, 'object', error);
      const errorMessage = `Status: ${error.data?.[1]}  ${error.message}`;
      this.snackBar.open(errorMessage, null, {
        ...this.artPlayerSnackBarOptions,
        duration: 2000,
      });
    });

    const dashAdapter = {
      ...player,
      getVideoElement: () => video,
      getBitrateInfoListFor: () => {
        const tracks = player.getVariantTracks();
        return tracks.map((track, index) => ({
          qualityIndex: index,
          width: track.width,
          height: track.height,
          bandwidth: track.bandwidth
        }));
      },
      getQualityFor: () => {
        const tracks = player.getVariantTracks();
        const active = tracks.find(track => track.active);
        return active ? tracks.indexOf(active) : 0;
      },
      getSettings: () => ({
        streaming: {
          abr: {
            autoSwitchBitrate: {
              video: !player.getConfiguration().abr.enabled
            }
          }
        }
      }),
      updateSettings: (settings: any) => {
        player.configure({
          abr: {
            enabled: settings.streaming.abr.autoSwitchBitrate.video
          }
        });
      },
      setQualityFor: (type: string, index: number) => {
        const tracks = player.getVariantTracks();
        player.selectVariantTrack(tracks[index], true);
      },
      getTracksFor: (type: string) => {
        if (type === 'audio') {
            return player.getVariantTracks()
                .filter(track => track.audioId) // Only get tracks with audio
                .map(track => ({
                    id: track.audioId,
                    lang: track.language || 'und',
                    name: track.language ? `Audio (${track.language})` : 'Audio Track',
                    roles: track.roles
                }));
        }
        return [];
      },
      getCurrentTrackFor: (type: string) => {
        if (type === 'audio') {
          const tracks = player.getVariantTracks();
          const active = tracks.find(track => track.active);
          return active ? { lang: active.language, id: active.language } : null;
        }
        return null;
      },
      setCurrentTrack: (track: any) => {
        player.selectAudioLanguage(track.lang);
      }
    };

    art.dash = dashAdapter; 

    art.on('destroy', () => player.destroy());
  }

  private initializePlayer(): void {
    if (!this.channel?.url) {
      console.error('Cannot initialize player: no URL provided');
      return;
    }

    try {

      const { kid, key, clearKeys } = this.getDrmInfo(this.channel);
      
      // Initialize player options
      this.options = {
        container: this.artplayer.nativeElement,
        url: this.channel.url,
        title: this.channel.name,
        muted: false,
        autoplay: true,
        pip: true,
        isLive: true,
        aspectRatio: true,
        fullscreen: true,
        subtitleOffset: true,
        screenshot: true,
        playsInline: true,
        lang: 'en',
        setting: true,
      };

      if (kid && key || clearKeys) {
        this.options = {
          ...this.options,
          plugins: [
            artplayerPluginDashControl({
              quality: {
                  control: true,
                  setting: true,
                  getName: (level: any) => {
                      if (!level.height) return 'Unknown';
                      return `${level.height}p`;
                  },
                  title: 'Quality',
                  auto: 'Auto',
              },
              audio: {
                  control: true,
                  setting: true,
                  getName: (track: any) => {
                      if (!track.lang || track.lang === 'und') return 'Default Audio';
                      return `Audio (${track.lang})`;
                  },
                  title: 'Audio',
                  auto: 'Auto',
              }
          }),
          ],
          type: 'mpd',
          customType: {
            mpd: (video: HTMLVideoElement, url: string, art: any) => 
                this.playMpd(video, url, art, kid, key, clearKeys)
          },
        };
      } else if (this.isMpegts(this.channel)) {
        // MPEGTS handling
        this.options = {
            ...this.options,
            type: 'flv',
            customType: {
                flv: (video: HTMLVideoElement, url: string, art: any) => 
                    this.playFlv(video, url, art)
            },
        };
    } else {
        this.options = {
          ...this.options,
          settings: [
            {
              html: 'Subtitle',
              tooltip: 'Subtitle',
              icon: '<img width="22" height="22" src="./assets/images/subtitle.svg">',
              switch: true,
              onSwitch: (item) => {
                if (this.player && this.player.hls) {
                  const nextState = !item.switch;
                  this.player.hls.subtitleTrack = nextState ? 0 : -1;
                  item.tooltip = nextState ? 'Open' : 'Close';
                  return nextState;
                }
                return false;
              },
            },
          ],
          plugins: [
            artplayerPluginHlsControl({
                quality: {
                    control: true,
                    setting: true,
                    getName: (level: any) => (level as { height: number }).height + 'P',
                    title: 'Quality',
                    auto: 'Auto',
                },
                audio: {
                    control: true,
                    setting: true,
                    getName: (track: any) => (track as { name: string }).name,
                    title: 'Audio',
                    auto: 'Auto',
                }
            }),
          ],
          type: 'm3u8',
          customType: {
            m3u8: (video: HTMLVideoElement, url: string, art: any) => 
              this.playM3u8(video, url, art)
          },
        };
      }


      // Create new ArtPlayer instance
      this.player = new ArtPlayer(this.options);

      // Add event listeners
      this.player.on('ready', () => {
        console.log('ArtPlayer is ready');
        if (this.player.hls) {
          console.log('HLS instance:', this.player.hls);
        }
      });

      this.player.on('video:error', (error: any) => {
        console.info('video:error', error);
      });
     

    } catch (error) {
      console.error('Failed to initialize art player:', error);
      this.destroyPlayer();
    }
  }

  isMpegts(channel: Channel): boolean {
    const mimetype = (channel.kodiprop['mimetype'] as string) || '';
    return mimetype.includes('video/mp2t');
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
