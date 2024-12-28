package rails

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/sst/sst/v3/internal/fs"
	"github.com/sst/sst/v3/pkg/project/common"
)

func Generate(root string, links common.Links) error {
	return nil
	projects := fs.FindDown(root, "config.ru")
	files := []io.Writer{}
	for _, project := range projects {
		// check if lib path exists
		if _, err := os.Stat(filepath.Join(filepath.Dir(project), "lib")); err == nil {
			path := filepath.Join(filepath.Dir(project), "lib", "sst.rb")
			file, _ := os.Create(path)
			files = append(files, file)
		}
	}
	writer := io.MultiWriter(files...)
	writer.Write([]byte(`require 'json'
module SST
  class << self
    private

    def parse_resource(resource_name)
      env_var = "SST_RESOURCE_#{resource_name}"
      parse_json(ENV[env_var])
    end

    def parse_json(json_string)
      return nil if json_string.nil?
      JSON.parse(json_string)
    rescue JSON::ParserError
      json_string  # Return the original string if it's not valid JSON
    end

  end
`,
	))

	for name := range links {
		writer.Write([]byte(fmt.Sprintf(`
  def %s
    @%s ||= parse_resource('%s')
  end
`, name, name, name)))
	}

	writer.Write([]byte("\nend"))

	return nil
}
