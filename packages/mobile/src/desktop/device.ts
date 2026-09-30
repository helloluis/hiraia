import { desktop } from './bridge';
export const totalMemory = desktop().info.totalMemory;
export const supportedCpuArchitectures = [desktop().info.arch];
export const osName = desktop().info.platform === 'win32' ? 'Windows' : desktop().info.platform;
export const osVersion = null;
export const modelName = 'Desktop';
export const deviceType = 3;
export const isDevice = true;
