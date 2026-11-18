export const publicAsset = (path: string) =>
  new URL(path.replace(/^\/+/, ''), document.baseURI).toString();
