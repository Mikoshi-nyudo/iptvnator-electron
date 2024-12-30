import {
    Component,
    Input,
    OnInit,
    OnDestroy,
    ElementRef,
    ViewChild,
    AfterViewInit,
    ViewEncapsulation,
    SimpleChanges
} from '@angular/core';
import { Channel } from '../../../../../shared/channel.interface';

declare const jwplayer: any;

@Component({
    selector: 'app-jw-player',
    templateUrl: './jw-player.component.html',
    styleUrls: ['./jw-player.component.scss'],
    encapsulation: ViewEncapsulation.None,
    standalone: true,
})
export class JwPlayerComponent implements OnInit, OnDestroy, AfterViewInit {
    /** DOM-element reference */
    @ViewChild('jwplayer', { static: true }) jwplayerContainer: ElementRef;

    /** Input properties for video player configuration */
    @Input() channel: Channel;

    /** JW Player instance */
    private player: any;
    private debounce: NodeJS.Timeout | null = null;
    private retryCount = 0;

    constructor() {}

    ngOnInit(): void {
        jwplayer.key = 'XSuP4qMl+9tK17QNb+4+th2Pm9AWgMO/cYH8CI0HGGr7bdjo';
    }

    ngAfterViewInit(): void {
        this.initializePlayer();
    }

    /**
     * Clean up on destroy
     */
    ngOnDestroy(): void {
        this.clearRetryTimeout();

        if (this.player) {
            this.player.remove();
        }
    }

    /**
     * Listen for component input changes
     * @param changes component changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes.channel && changes.channel.currentValue) {
            this.updatePlayerSource(changes.channel.currentValue);
        }
    }

    getPlayerConfig(channel: Channel): any {
        const { kid, key, licenseUrl } = this.getDrmInfo(channel);

        const playerOptions: any = {
            file: channel.url,
            width: '100%',
            aspectratio: '16:9',
            autostart: true,
            responsive: true,
            controls: true,
            displaytitle: true,
            pipIcon: true,
            liveTimeout: 0,
            stretching: 'uniform',
            style: {
                margin: '0 0 48px 0'
            }
        };

        if (kid && key) {
            playerOptions.drm = {
                clearkey: {
                    key: key,
                    keyId: kid,
                },
            };
        } else if (licenseUrl) {
            playerOptions.drm = {
                widevine: {
                    url: licenseUrl
                }
            };
        }
    

        return playerOptions;
    }

    private clearRetryTimeout(): void {
        if (this.debounce) {
            clearTimeout(this.debounce);
            this.debounce = null;
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

            this.clearRetryTimeout();

            this.debounce = setTimeout(() => {
                this.player.load([{ file: this.channel.url }]);
                this.player.play();
            }, retryDelay);
        };

        ['setupError', 'playAttemptFailed', 'error'].forEach((event) => {
            this.player.on(event, retryPlayback);
        });

        console.log(JSON.stringify(this.channel));
    }

    updatePlayerSource(channel: Channel): void {
        if (!channel?.url) {
            console.error('Invalid channel URL provided.');
            return;
        }

        if (!this.player) {
            this.initializePlayer();
            return;
        }

        this.clearRetryTimeout();
        this.retryCount = 0;
        this.player.remove();
        this.player = jwplayer('jwplayer').setup(this.getPlayerConfig(channel));
        this.setupPlayerEvents();
        this.player.play();
    }

    initializePlayer(): void {
        if (!this.channel?.url) {
            console.error('Video URL is required for JW Player');
            return;
        }

        this.clearRetryTimeout();
        this.retryCount = 0;
        this.player = jwplayer('jwplayer').setup(this.getPlayerConfig(this.channel));
        this.setupPlayerEvents();
    }

    getDrmInfo(channel: Channel) {
        const licenseKey = (channel.kodiprop['inputstream.adaptive.license_key'] as string);
        const licenseType = (channel.kodiprop['inputstream.adaptive.license_type'] as string);

        if (!licenseKey || !licenseType) {
            return { kid: null, key: null, licenseUrl: null };
        }

        if (licenseType.includes('clearkey')) {
            const [kid, key] = licenseKey.split(":");
            return { kid, key, licenseUrl: null };
        } 
        
        if (licenseType.includes('widevine')) {
            return { kid: null, key: null, licenseUrl: licenseKey };
        }

        return { kid: null, key: null, licenseUrl: null };
    }

}
