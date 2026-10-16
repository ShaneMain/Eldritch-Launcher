import {
    createContext,
    type FC,
    type PropsWithChildren,
    useContext,
    useEffect,
    useState,
} from 'react';
import { appBridge } from '../renderer.bridge.ts';

type AppContext = {
    appVersion: string | undefined;
};

const appContext = createContext<AppContext>({} as AppContext);

/** Reads shared application information. */
export const useApp = () => useContext(appContext);

/**
 * Shares application information across views.
 *
 * @param props - Child views that consume the application state.
 */
export const AppProvider: FC<PropsWithChildren> = ({ children }) => {
    const [appVersion, setAppVersion] = useState<string>();

    useEffect(() => {
        appBridge.getAppVersion().then(setAppVersion);
    }, []);

    return (
        <appContext.Provider value={{ appVersion }}>
            {children}
        </appContext.Provider>
    );
};
