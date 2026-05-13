type ReactModule = typeof import('react');
type PatchFn = (...args: unknown[]) => unknown;

type StashPluginApi = {
  React: ReactModule;
  patch: {
    instead: (component: string, fn: PatchFn) => void;
    before: (component: string, fn: PatchFn) => void;
    after: (component: string, fn: PatchFn) => void;
  };
  utils?: {
    loadComponents?: (components: Array<Promise<unknown>>) => void;
  };
  loadableComponents?: Record<string, Promise<unknown>>;
};

const pluginApi = (window as Window & { PluginApi: StashPluginApi }).PluginApi;

export const PluginApi = pluginApi;
export const React = pluginApi.React;
