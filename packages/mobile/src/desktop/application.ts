import { desktop } from './bridge';
export const nativeApplicationVersion = desktop().info.version;
export const nativeBuildVersion = String(desktop().info.build);
export const applicationId = 'org.hiraia.desktop';
export const applicationName = 'Hiraia';
