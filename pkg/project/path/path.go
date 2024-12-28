package path

import "path/filepath"

func ResolveWorkingDir(cfgPath string) string {
	return filepath.Join(ResolveRootDir(cfgPath), ".sst")
}

func ResolvePlatformDir(cfgPath string) string {
	return filepath.Join(ResolveWorkingDir(cfgPath), "platform")
}

func ResolveLogDir(cfgPath string) string {
	return filepath.Join(ResolveWorkingDir(cfgPath), "log")
}

func ResolveRootDir(cfgPath string) string {
	return filepath.Dir(cfgPath)
}

func ResolveProviderLock(cfgPath string) string {
	return filepath.Join(ResolveWorkingDir(cfgPath), "provider-lock.json")
}
