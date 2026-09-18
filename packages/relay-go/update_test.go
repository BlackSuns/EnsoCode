package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestVersionNewer(t *testing.T) {
	cases := []struct {
		current, latest string
		want            bool
	}{
		{"v1.0.0", "v1.0.1", true},
		{"1.0.0", "v1.0.1", true},
		{"v1.0.1", "v1.0.1", false},
		{"v1.0.1", "v1.0.0", false},
		{"v1.2.0", "v1.10.0", true},
		{"v2.0.0", "v1.9.9", false},
		{"dev", "v1.0.0", false},
		{"", "v1.0.0", false},
		{"v1.0.0", "dev", false},
		{"v1.0.0", "", false},
		{"v1.2", "v1.2.1", true},
		{"v1.2.0", "v1.2", false},
	}
	for _, tc := range cases {
		got := versionNewer(tc.current, tc.latest)
		if got != tc.want {
			t.Fatalf("versionNewer(%q,%q)=%v want %v", tc.current, tc.latest, got, tc.want)
		}
	}
}

func TestRelayAssetName(t *testing.T) {
	if got := relayAssetName("linux", "amd64"); got != "enso-relay-linux-amd64" {
		t.Fatalf("got %q", got)
	}
	if got := relayAssetName("linux", "arm64"); got != "enso-relay-linux-arm64" {
		t.Fatalf("got %q", got)
	}
}

func TestParseChecksums(t *testing.T) {
	body := []byte("" +
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  enso-relay-linux-amd64\n" +
		"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *enso-relay-linux-arm64\r\n" +
		"# comment\n" +
		"not-a-hash  skip-me\n" +
		"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  /tmp/evil\n")
	got := parseChecksums(body)
	if got["enso-relay-linux-amd64"] != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("amd64 %q", got["enso-relay-linux-amd64"])
	}
	if got["enso-relay-linux-arm64"] != "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" {
		t.Fatalf("arm64 %q", got["enso-relay-linux-arm64"])
	}
	if _, ok := got["skip-me"]; ok {
		t.Fatal("accepted invalid hash")
	}
	if got["evil"] != "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" {
		t.Fatalf("basename %v", got)
	}
}

func TestReplaceExecutable(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "enso-relay")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := replaceExecutable(exe, []byte("new-bytes")); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new-bytes" {
		t.Fatalf("got %q", got)
	}
	st, err := os.Stat(exe)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode()&0o111 == 0 {
		t.Fatalf("not executable: %s", st.Mode())
	}
}

func TestExeUpdatable(t *testing.T) {
	if !exeUpdatable("/usr/local/bin/enso-relay") {
		t.Fatal("release path should be updatable")
	}
	if exeUpdatable("/tmp/go-build123/b001/exe/enso-relay") {
		t.Fatal("go-build should not update")
	}
	if exeUpdatable("") {
		t.Fatal("empty")
	}
}

func TestEnvBoolAndDuration(t *testing.T) {
	t.Setenv("RELAY_AUTO_UPDATE", "0")
	if envBool("RELAY_AUTO_UPDATE", true) {
		t.Fatal("expected false")
	}
	t.Setenv("RELAY_AUTO_UPDATE", "yes")
	if !envBool("RELAY_AUTO_UPDATE", false) {
		t.Fatal("expected true")
	}
	t.Setenv("RELAY_UPDATE_INTERVAL", "2h")
	if envDuration("RELAY_UPDATE_INTERVAL", time.Hour) != 2*time.Hour {
		t.Fatal("duration")
	}
	t.Setenv("RELAY_UPDATE_INTERVAL", "nope")
	if envDuration("RELAY_UPDATE_INTERVAL", 4*time.Hour) != 4*time.Hour {
		t.Fatal("fallback")
	}
	t.Setenv("RELAY_UPDATE_INTERVAL", "5s")
	if envDuration("RELAY_UPDATE_INTERVAL", 4*time.Hour) != 4*time.Hour {
		t.Fatal("too short should fallback")
	}
}

func TestCheckAndApply(t *testing.T) {
	payload := []byte("new-relay-binary")
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	asset := "enso-relay-linux-amd64"

	var binaryHits atomic.Int32
	var latestHits atomic.Int32

	mux := http.NewServeMux()
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	mux.HandleFunc("/repos/J3n5en/EnsoCode/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		latestHits.Add(1)
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("missing User-Agent")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v1.1.0",
			"assets": []map[string]string{
				{"name": asset, "browser_download_url": ts.URL + "/download/" + asset},
				{"name": checksumsName, "browser_download_url": ts.URL + "/download/" + checksumsName},
			},
		})
	})
	mux.HandleFunc("/download/"+checksumsName, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, hash+"  "+asset+"\n")
	})
	mux.HandleFunc("/download/"+asset, func(w http.ResponseWriter, r *http.Request) {
		binaryHits.Add(1)
		_, _ = w.Write(payload)
	})

	dir := t.TempDir()
	exe := filepath.Join(dir, "enso-relay")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}

	u := testUpdater(ts, exe, "v1.0.0")
	applied, err := u.checkAndApply(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !applied {
		t.Fatal("expected apply")
	}
	got, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("exe %q", got)
	}
	if binaryHits.Load() != 1 {
		t.Fatalf("binary hits %d", binaryHits.Load())
	}

	u.current = "v1.1.0"
	applied, err = u.checkAndApply(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if applied {
		t.Fatal("same version should not apply")
	}
	if binaryHits.Load() != 1 {
		t.Fatalf("should not redownload, hits %d", binaryHits.Load())
	}
}

func TestCheckAndApply_RejectsChecksumMismatch(t *testing.T) {
	payload := []byte("new-relay-binary")
	asset := "enso-relay-linux-amd64"
	mux := http.NewServeMux()
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	mux.HandleFunc("/repos/J3n5en/EnsoCode/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v1.1.0",
			"assets": []map[string]string{
				{"name": asset, "browser_download_url": ts.URL + "/download/" + asset},
				{"name": checksumsName, "browser_download_url": ts.URL + "/download/" + checksumsName},
			},
		})
	})
	mux.HandleFunc("/download/"+checksumsName, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  "+asset+"\n")
	})
	mux.HandleFunc("/download/"+asset, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(payload)
	})

	dir := t.TempDir()
	exe := filepath.Join(dir, "enso-relay")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	u := testUpdater(ts, exe, "v1.0.0")
	applied, err := u.checkAndApply(context.Background())
	if err == nil || applied {
		t.Fatalf("applied=%v err=%v", applied, err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != "old" {
		t.Fatalf("binary replaced on mismatch: %q", got)
	}
}

func TestCheckAndApply_RejectsForeignHost(t *testing.T) {
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("downloaded from foreign host")
		_, _ = w.Write([]byte("evil"))
	}))
	t.Cleanup(evil.Close)

	mux := http.NewServeMux()
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	mux.HandleFunc("/repos/J3n5en/EnsoCode/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v1.1.0",
			"assets": []map[string]string{
				{"name": "enso-relay-linux-amd64", "browser_download_url": evil.URL + "/bin"},
				{"name": checksumsName, "browser_download_url": evil.URL + "/sum"},
			},
		})
	})

	dir := t.TempDir()
	exe := filepath.Join(dir, "enso-relay")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	u := testUpdater(ts, exe, "v1.0.0")
	applied, err := u.checkAndApply(context.Background())
	if err == nil || applied {
		t.Fatalf("applied=%v err=%v", applied, err)
	}
}

func TestCheckAndApply_SkipsDev(t *testing.T) {
	called := false
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(500)
	}))
	t.Cleanup(ts.Close)
	u := testUpdater(ts, filepath.Join(t.TempDir(), "enso-relay"), "dev")
	applied, err := u.checkAndApply(context.Background())
	if err != nil || applied {
		t.Fatalf("applied=%v err=%v", applied, err)
	}
	if called {
		t.Fatal("dev build should not hit GitHub")
	}
}

func TestCheckAndApply_MissingChecksums(t *testing.T) {
	mux := http.NewServeMux()
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	mux.HandleFunc("/repos/J3n5en/EnsoCode/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": "v1.1.0",
			"assets": []map[string]string{
				{"name": "enso-relay-linux-amd64", "browser_download_url": ts.URL + "/bin"},
			},
		})
	})
	u := testUpdater(ts, filepath.Join(t.TempDir(), "enso-relay"), "v1.0.0")
	applied, err := u.checkAndApply(context.Background())
	if err == nil || applied {
		t.Fatalf("applied=%v err=%v", applied, err)
	}
}

func TestLoop_PeriodicThenApply(t *testing.T) {
	payload := []byte("new-relay-binary")
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	asset := "enso-relay-linux-amd64"
	var n atomic.Int32

	mux := http.NewServeMux()
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	mux.HandleFunc("/repos/J3n5en/EnsoCode/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		tag := "v1.0.0"
		if n.Add(1) >= 2 {
			tag = "v1.1.0"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name": tag,
			"assets": []map[string]string{
				{"name": asset, "browser_download_url": ts.URL + "/download/" + asset},
				{"name": checksumsName, "browser_download_url": ts.URL + "/download/" + checksumsName},
			},
		})
	})
	mux.HandleFunc("/download/"+checksumsName, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, hash+"  "+asset+"\n")
	})
	mux.HandleFunc("/download/"+asset, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(payload)
	})

	dir := t.TempDir()
	exe := filepath.Join(dir, "enso-relay")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	u := testUpdater(ts, exe, "v1.0.0")
	u.interval = 20 * time.Millisecond

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	applied := make(chan struct{})
	go u.loop(ctx, func() { close(applied) })

	select {
	case <-applied:
	case <-ctx.Done():
		t.Fatal("loop did not apply")
	}
	got, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("exe %q", got)
	}
}

func TestStripUpdateFlag(t *testing.T) {
	got := stripUpdateFlag([]string{"enso-relay", "--update", "--listen", ":9"})
	if strings.Join(got, " ") != "enso-relay --listen :9" {
		t.Fatalf("%v", got)
	}
	got = stripUpdateFlag([]string{"enso-relay", "-update=true"})
	if strings.Join(got, " ") != "enso-relay" {
		t.Fatalf("%v", got)
	}
}

func testUpdater(ts *httptest.Server, exe, current string) *selfUpdater {
	return &selfUpdater{
		current: current,
		repo:    "J3n5en/EnsoCode",
		apiBase: ts.URL,
		goos:    "linux",
		goarch:  "amd64",
		exe:     exe,
		client:  ts.Client(),
		log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}
