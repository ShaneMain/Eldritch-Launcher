export type BackendResult = {
    success: boolean;
    error?: string;
};

export type SetAutoStartResult = BackendResult;

export type * from './app.bridge.js';
