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
import { DataService } from '../../../services/data.service';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';


declare const shaka: any;

@Component({
  selector: 'app-shaka-player',
  templateUrl: './shaka-player.component.html',
  styleUrls: ['./shaka-player.component.scss'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
})

export class ShakaPlayerComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('shakaplayer', { static: true }) shakaplayer: ElementRef;
  @ViewChild('shakacontainer', { static: true }) shakacontainer: ElementRef;
  @Input() channel: Channel;

  shakaSnackBarOptions: MatSnackBarConfig = {
    verticalPosition: 'bottom',
    horizontalPosition: 'start',
    panelClass: 'custom-snackbar',
  };

  private player: any;
  private ui: any = null;
  private isDestroying = false;

  dataService: DataService; // Declare the dataService property

  constructor(
    dataService: DataService,
    private snackBar: MatSnackBar
  ) {
    this.dataService = dataService; // Inject the DataService
  }

  ngOnInit(): void {
    shaka.polyfill.installAll();
  }

  ngAfterViewInit(): void {
    this.initializePlayer();
  }

  ngOnDestroy(): void {
    if (this.player) {
      this.destroyPlayer().catch(error => {
        console.error('Error during player cleanup:', error);
      });
    }

  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.channel && changes.channel.currentValue) {
      // Handle the promise but don't block component lifecycle
      this.destroyPlayer().then(() => {
        if (!this.ui) {
          this.initializePlayer();
        }
      }).catch(error => {
        console.error('Error during player reinitialize:', error);
      });
    }
  }

  async destroyPlayer(): Promise<void> {
    if (this.player) {
      this.isDestroying = true;

      await this.player.destroy();
      this.player = null;

      // Destroy the Shaka UI overlay
      if (this.ui) {
        this.ui.destroy();
        this.ui = null;
      }

      // Clean up window reference
      if (window['player']) {
        delete window['player'];
      }

      this.isDestroying = false;
    }
    return Promise.resolve();
  }

  async initializePlayer(): Promise<void> {
    if (this.isDestroying || !this.channel?.url) {
      console.error('Cannot initialize player: destroying or no URL provided');
      return;
    }

    try {
      const video = this.shakaplayer.nativeElement;
      const videoContainer = this.shakacontainer.nativeElement;

      this.player = new shaka.Player(video);

      // Set up retry handler for 404s
      // const networkingEngine = this.player.getNetworkingEngine();
      // networkingEngine.addEventListener('retry', (event) => {
      //   const error = event.error;
        
      //   if (error.code === shaka.util.Error.Code.BAD_HTTP_STATUS && 
      //       error.data && error.data[1] === 404) {
          
      //     this.snackBar.open("The stream is not available. 404 (Not Found)", null, {
      //       ...this.shakaSnackBarOptions,
      //       duration: 2000,
      //     });

      //     // For VOD content, stop retrying immediately
      //     if (!this.player.isLive()) {
      //       throw error; // This will stop retries and propagate as a critical error
      //     }
      //   }
      // });

      // Configure streaming error handling
      this.player.configure('streaming.failureCallback', (error) => {
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
          if (!this.player.isLive()) {
            error.severity = shaka.util.Error.Severity.CRITICAL;
            return;
          }
        }

        // For live streams, retry on network errors
        if (this.player.isLive() && retryErrorCodes.includes(error.code)) {
          error.severity = shaka.util.Error.Severity.RECOVERABLE;
          console.log('Live streaming error. Retrying automatically...');
          this.player.retryStreaming();
        } else {
          // Make other errors recoverable by default
          error.severity = shaka.util.Error.Severity.RECOVERABLE;
        }
      });

      // Handle general errors
      this.player.addEventListener('error', (event) => {
        const error = event.detail;
        console.error('Player error:', error);
      });

      const config = {
        'seekBarColors': {
          base: 'rgba(255,255,255,.2)',
          buffered: 'rgba(255,255,255,.4)',
          played: 'rgb(255,0,0)',
        },
        'customContextMenu' : true,
        'contextMenuElements' : ['statistics'],
      }
      // 'overflowMenuButtons': ['statistics', 'captions', 'quality', 'language']

      this.ui = new shaka.ui.Overlay(this.player, videoContainer, video);
      this.ui.configure(config);

      const controls = this.ui.getControls();
      this.player = controls.getPlayer();

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

      const { kid, key, clearKeys } = this.getDrmInfo(this.channel);

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

      this.player.configure(shakaConfig);

      this.player.load(this.channel.url).then(() => {
        console.log('The video has now been loaded!');
        this.snackBar.open("The video has now been loaded. Please wait...", null, {
          ...this.shakaSnackBarOptions,
          duration: 2000,
        });
        
      }).catch((error) => {
        console.error('Error code', error.code, 'object', error);
        const errorMessage = `Status: ${error.data?.[1]}  ${error.message}`;
        this.snackBar.open(errorMessage, null, {
          ...this.shakaSnackBarOptions,
          duration: 2000,
        });
      });

      
    } catch (error) {
      console.error('Failed to initialize player:', error);
      const errorMessage = `Status: ${error.data?.[1]}  ${error.message}`;
      this.snackBar.open(errorMessage, null, {
        ...this.shakaSnackBarOptions,
        duration: 2000,
      });
      await this.destroyPlayer();
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