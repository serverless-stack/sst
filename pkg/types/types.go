package types

import (
	"log/slog"

	"github.com/sst/sst/v3/pkg/project/common"
	"github.com/sst/sst/v3/pkg/project/path"
	"github.com/sst/sst/v3/pkg/types/python"
	"github.com/sst/sst/v3/pkg/types/rails"
	"github.com/sst/sst/v3/pkg/types/typescript"
)

type Generator = func(root string, complete common.Links) error

func Generate(cfgPath string, complete common.Links) error {
	root := path.ResolveRootDir(cfgPath)
	// gitroot, err := fs.FindUp(root, ".git")
	// if err == nil {
	// 	root = filepath.Dir(gitroot)
	// }
	slog.Info("generating types", "root", root)
	for _, generator := range All {
		err := generator(root, complete)
		if err != nil {
			return err
		}
	}
	return nil
}

var All = []Generator{
	typescript.Generate,
	python.Generate,
	rails.Generate,
}
