// `subset-font` non pubblica i tipi: qui c'è solo la parte usata da `scripts/subset-pieces-font.ts`.
declare module 'subset-font' {
  interface SubsetOptions {
    readonly targetFormat?: 'sfnt' | 'woff' | 'woff2' | 'truetype';
    readonly preserveNameIds?: readonly number[];
  }
  export default function subsetFont(font: Buffer, text: string, options?: SubsetOptions): Promise<Buffer>;
}
