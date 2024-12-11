package errors

import (
	"errors"
	"fmt"
	"strings"

	"github.com/sst/ion/cmd/sst/mosaic/aws"
	"github.com/sst/ion/cmd/sst/mosaic/aws/appsync"
	"github.com/sst/ion/internal/util"
	"github.com/sst/ion/pkg/project"
	"github.com/sst/ion/pkg/project/provider"
	"github.com/sst/ion/pkg/server"
)

type ErrorTransformer = func(err error) (bool, error)

var transformers = []ErrorTransformer{
	exact(appsync.ErrSubscriptionFailed, "Failed to subscribe to appsync websocket endpoint which powers live lambda. Check to see if you have proper appsync permissions."),
	exact(project.ErrInvalidStageName, "The stage name is invalid. It can only contain alphanumeric characters and hyphens."),
	exact(project.ErrInvalidAppName, "The app name is invalid. It can only contain alphanumeric characters and hyphens."),
	exact(project.ErrAppNameChanged, "The app name has changed.\n\nIf you want to rename the app, make sure to run `sst remove` to remove the old app first. Alternatively, remove the \".sst\" folder and try again.\n"),
	exact(project.ErrV2Config, "You are using sst v3 and this looks like an sst v2 config"),
	exact(project.ErrStageNotFound, "Stage not found"),
	exact(project.ErrPassphraseInvalid, "The passphrase for this app / stage is missing or invalid"),
	exact(aws.ErrIoTDelay, "This aws account has not had iot initialized in it before which sst depends on. It may take a few minutes before it is ready."),
	exact(project.ErrStackRunFailed, ""),
	exact(provider.ErrLockExists, ""),
	exact(project.ErrVersionInvalid, "The version range defined in the config is invalid"),
	exact(provider.ErrCloudflareMissingAccount, "The Cloudflare Account ID was not able to be determined from this token. Make sure it has permissions to fetch account information or you can set the CLOUDFLARE_DEFAULT_ACCOUNT_ID environment variable to the account id you want to use."),
	exact(server.ErrServerNotFound, "Could not find an `sst dev` session to connect to. Since you are running a command outside of the multiplexer be sure to start `sst dev` first."),
	exact(provider.ErrBucketMissing, "The state bucket is missing, it may have been accidentally deleted. Go to https://console.aws.amazon.com/systems-manager/parameters/%252Fsst%252Fbootstrap/description?tab=Table and check if the state bucket mentioned there exists. If it doesn't you can recreate it or delete the `/sst/bootstrap` key to force recreation."),
	exact(project.ErrBuildFailed, project.ErrBuildFailed.Error()),
	exact(project.ErrVersionMismatch, project.ErrVersionMismatch.Error()),
	exact(project.ErrProtectedStage, "Cannot remove protected stage. To remove a protected stage edit your sst.config.ts and remove the `protect` property."),
	match(func(err *project.ErrProviderVersionTooLow) string {
		return fmt.Sprintf("You specified version %s of the \"%s\" provider. SST needs %s or higher.", err.Version, err.Name, err.Needed)
	}),
	func(err error) (bool, error) {
		msg := err.Error()
		if !strings.HasPrefix(msg, "aws:") {
			return false, nil
		}
		if strings.Contains(msg, "cached SSO token is expired") {
			return true, util.NewHintedError(err, "It looks like you are using AWS SSO but your credentials have expired. Try running `aws sso login` to refresh your credentials.")
		}
		if strings.Contains(msg, "no EC2 IMDS role found") {
			return true, util.NewHintedError(err, "AWS credentials are not configured. Try configuring your profile in `~/.aws/config` and setting the `AWS_PROFILE` environment variable or specifying `providers.aws.profile` in your sst.config.ts")
		}
		return false, nil
	},
}

func Transform(err error) error {
	for _, t := range transformers {
		if ok, err := t(err); ok {
			return err
		}
	}
	return err
}

func match[T error](transformer func(T) string) ErrorTransformer {
	return func(err error) (bool, error) {
		var match T
		if errors.As(err, &match) {
			str := transformer(match)
			return true, util.NewReadableError(err, str)
		}
		return false, nil
	}
}

func exact(compare error, msg string) ErrorTransformer {
	return func(err error) (bool, error) {
		if errors.Is(err, compare) {
			return true, util.NewReadableError(err, msg)
		}
		return false, nil
	}
}
