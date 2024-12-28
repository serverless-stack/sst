package global

import (
	"os"
	"path/filepath"

	"github.com/pulumi/pulumi/sdk/v3"
	"github.com/sst/sst/v3/pkg/flag"
)

var PULUMI_VERSION = "v" + sdk.Version.String()
var BUN_VERSION = func() string {
	if flag.SST_BUN_VERSION != "" {
		return flag.SST_BUN_VERSION
	}
	return "1.1.38"
}()

const UV_VERSION = "0.3.2"

var configDir = (func() string {
	home, err := os.UserConfigDir()
	if err != nil {
		panic(err)
	}
	result := filepath.Join(home, "sst")
	os.Setenv("PATH", result+"/bin:"+os.Getenv("PATH"))
	os.MkdirAll(result, 0755)
	os.MkdirAll(filepath.Join(result, "bin"), 0755)
	return result
}())

func ConfigDir() string {
	return configDir
}

func BinPath() string {
	return filepath.Join(configDir, "bin")
}

func CertPath() string {
	return filepath.Join(configDir, "cert")
}
