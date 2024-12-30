package tunnel

import (
	"os"
	"path/filepath"
)

type windowsPlatform struct{}

func init() {
	// Use Windows-style path
	BINARY_PATH = filepath.Join(os.Getenv("PROGRAMFILES"), "SST", "tunnel.exe")
	impl = &windowsPlatform{}
}

func (p *windowsPlatform) destroy() error {
	return nil
}

func (p *windowsPlatform) start(routes ...string) error {
	// Windows-specific installation
	return nil
}

// Override Install for Windows
func (p *windowsPlatform) install() error {
	// Windows-specific installation
	return nil
}
