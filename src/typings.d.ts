/* SystemJS module definition */
declare const nodeModule: NodeModule;
interface NodeModule {
    id: string;
}
interface Window {
    process: any;
    require: any;
}

export interface ParsedPlaylist {
    header: {
        attrs: {
            'x-tvg-url': string;
        };
        raw: string;
    };
    items: ParsedPlaylistItem[];
}

export interface ParsedPlaylistItem {
    name: string;
    tvg: {
        id: string;
        name: string;
        url: string;
        logo: string;
        rec: string;
    };
    group: {
        title: string;
    };
    http: {
        referrer: string;
        'user-agent': string;
    };
    url: string;
    radio: string;
    raw: string;
    kodiprop: {
        [key: string]: string | object;
    };
    kodiprop_raw: string;
    exhttp: {
        [key: string]: string | object;
    };
    exhttp_raw: string;
}
