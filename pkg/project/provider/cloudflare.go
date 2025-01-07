package provider

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	_ "unsafe"

	cloudflare "github.com/cloudflare/cloudflare-go"
	"github.com/sst/sst/v3/internal/util"
)

type CloudflareProvider struct {
	api              *cloudflare.API
	identifier       *cloudflare.ResourceContainer
	defaultAccountId string
}

var ErrCloudflareMissingAccount = fmt.Errorf("missing account")

func (c *CloudflareProvider) Env() (map[string]string, error) {
	return map[string]string{
		"CLOUDFLARE_DEFAULT_ACCOUNT_ID": c.defaultAccountId,
	}, nil
}

func (c *CloudflareProvider) Init(app, stage string, args map[string]interface{}) error {
	apiToken := os.Getenv("CLOUDFLARE_API_TOKEN")
	apiKey := os.Getenv("CLOUDFLARE_API_KEY")
	email := os.Getenv("CLOUDFLARE_EMAIL")
	if args["apiToken"] != nil {
		apiToken = args["apiToken"].(string)
	}
	if args["apiKey"] != nil {
		apiKey = args["apiKey"].(string)
	}
	if args["email"] != nil {
		email = args["email"].(string)
	}
	var api *cloudflare.API
	if apiToken != "" {
		api, _ = cloudflare.NewWithAPIToken(apiToken)
	}
	if apiKey != "" && email != "" {
		api, _ = cloudflare.New(apiKey, email)
	}
	if api == nil {
		return util.NewReadableError(nil, "Cloudflare API not initialized. Please provide CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL environment variables or in the provider section of the project configuration file.")
	}
	c.api = api
	accountID := os.Getenv("CLOUDFLARE_DEFAULT_ACCOUNT_ID")
	if accountID == "" {
		accounts, _, err := c.api.Accounts(context.Background(), cloudflare.AccountsListParams{})
		if err != nil {
			return err
		}
		if len(accounts) == 0 {
			return ErrCloudflareMissingAccount
		}
		accountID = accounts[0].ID
	}
	c.defaultAccountId = accountID
	c.identifier = cloudflare.AccountIdentifier(accountID)
	slog.Info("cloudflare account selected", "account", accountID)
	return nil
}

func (c CloudflareProvider) Api() *cloudflare.API {
	return c.api
}

type CloudflareHome struct {
	provider  *CloudflareProvider
	bootstrap *bootstrap
}

func NewCloudflareHome(provider *CloudflareProvider) *CloudflareHome {
	return &CloudflareHome{
		provider: provider,
	}
}

type bootstrap struct {
	State string `json:"state"`
}

func (c *CloudflareHome) Bootstrap() error {
	ctx := context.Background()
	buckets, err := c.provider.api.ListR2Buckets(ctx, c.provider.identifier, cloudflare.ListR2BucketsParams{
		Name: "sst-state",
	})
	if err != nil {
		return err
	}
	for _, bucket := range buckets {
		if bucket.Name == "sst-state" {
			slog.Info("found existing bucket", "bucket", bucket.Name)
			c.bootstrap = &bootstrap{
				State: bucket.Name,
			}
		}
	}

	if c.bootstrap == nil {
		slog.Info("creating new bucket", "bucket", "sst-state")
		_, err = c.provider.api.CreateR2Bucket(ctx, c.provider.identifier, cloudflare.CreateR2BucketParameters{
			Name: "sst-state",
		})
		if err != nil {
			return err
		}
		c.bootstrap = &bootstrap{
			State: "sst-state",
		}
	}

	return nil
}

//go:linkname makeRequestContext github.com/cloudflare/cloudflare-go.(*API).makeRequestContext
func makeRequestContext(*cloudflare.API, context.Context, string, string, interface{}) ([]byte, error)

func (c *CloudflareHome) putData(kind, app, stage string, data io.Reader) error {
	path := filepath.Join(kind, app, stage)
	_, err := makeRequestContext(c.provider.api, context.Background(), http.MethodPut, "/accounts/"+c.provider.identifier.Identifier+"/r2/buckets/"+c.bootstrap.State+"/objects/"+path, data)
	if err != nil {
		return err
	}
	return nil
}

func (c *CloudflareHome) getData(kind, app, stage string) (io.Reader, error) {
	path := filepath.Join(kind, app, stage)
	data, err := makeRequestContext(c.provider.api, context.Background(), http.MethodGet, "/accounts/"+c.provider.identifier.Identifier+"/r2/buckets/"+c.bootstrap.State+"/objects/"+path, nil)
	if err != nil {
		if err.Error() == "The specified key does not exist. (10007)" {
			return nil, nil
		}
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (c *CloudflareHome) removeData(kind, app, stage string) error {
	path := filepath.Join(kind, app, stage)
	_, err := makeRequestContext(c.provider.api, context.Background(), http.MethodDelete, "/accounts/"+c.provider.identifier.Identifier+"/r2/buckets/"+c.bootstrap.State+"/objects/"+path, nil)
	if err != nil {
		return err
	}
	return nil
}

// these should go into secrets manager once it's out of beta
func (c *CloudflareHome) setPassphrase(app, stage string, passphrase string) error {
	return c.putData("passphrase", app, stage, bytes.NewReader([]byte(passphrase)))
}

func (c *CloudflareHome) getPassphrase(app, stage string) (string, error) {
	data, err := c.getData("passphrase", app, stage)
	if err != nil {
		return "", err
	}
	if data == nil {
		return "", nil
	}
	read, err := io.ReadAll(data)
	if err != nil {
		return "", err
	}
	return string(read), nil
}
