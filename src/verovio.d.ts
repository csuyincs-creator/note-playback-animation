declare module 'verovio/wasm' {
  const createModule: () => Promise<unknown>;
  export default createModule;
}
declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    resetXmlIdSeed(seed: number): void;
    setOptions(options: Record<string, string | number | boolean>): void;
    loadData(data: string): boolean;
    renderToSVG(page: number): string;
    getPageCount(): number;
  }
}
