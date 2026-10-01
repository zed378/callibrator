/**
 * A full-document navigation to another origin (an identity provider). One
 * seam, so tests can observe it: jsdom's `window.location` cannot be replaced.
 */
export const assignLocation = (url: string): void => {
  window.location.assign(url);
};
