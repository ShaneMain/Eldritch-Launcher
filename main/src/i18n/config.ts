export const DEFAULT_LOCALE = 'en';

export const SUPPORTED_LOCALES = [
    'en',
    'it',
    'pt',
    'pt-BR',
    'zh-CN',
    'zh-TW',
    'de',
    'fr',
    'es',
    'pl',
    'ru',
    'ja',
    'tr',
    'mt',
] as const;

export const I18N_NAMESPACES = [
    'common',
    'projects',
    'installs',
    'exportTemplates',
    'settings',
    'help',
    'createProject',
    'installEditor',
    'welcome',
    'dialogs',
    'menus',
    'githubAuth',
    'engineSources',
    'projectStatus',
] as const;
