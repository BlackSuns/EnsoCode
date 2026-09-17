package main

import (
	"path/filepath"
	"testing"
)

func TestStoreRoundTrip(t *testing.T) {
	st, err := openStore(filepath.Join(t.TempDir(), "relay.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })

	got, err := st.get("missing")
	if err != nil || got != nil {
		t.Fatalf("missing: %#v %v", got, err)
	}

	s, _ := request(nil, 1000, "pk")
	if err := st.put("p1", s); err != nil {
		t.Fatal(err)
	}
	got, err = st.get("p1")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.HostPublicKey != "pk" || got.Phase != pairPhaseRequested {
		t.Fatalf("got %#v", got)
	}

	res := claim(got, 1000, "boxed", "phone")
	if !res.ok {
		t.Fatal(res.error)
	}
	if err := st.put("p1", res.next); err != nil {
		t.Fatal(err)
	}
	got, err = st.get("p1")
	if err != nil || got.HostToken != res.next.HostToken {
		t.Fatalf("authorized %#v %v", got, err)
	}

	if err := st.delete("p1"); err != nil {
		t.Fatal(err)
	}
	got, err = st.get("p1")
	if err != nil || got != nil {
		t.Fatalf("deleted %#v %v", got, err)
	}
}

func TestStoreRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "relay.sqlite")
	st, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	s, _ := request(nil, 1000, "pk")
	if err := st.put("p1", s); err != nil {
		t.Fatal(err)
	}
	_ = st.close()

	st, err = openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })
	got, err := st.get("p1")
	if err != nil || got == nil || got.HostPublicKey != "pk" {
		t.Fatalf("after reopen %#v %v", got, err)
	}
}

func TestConcurrentClaimOnce(t *testing.T) {
	st, err := openStore(filepath.Join(t.TempDir(), "relay.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.close() })
	s, _ := request(nil, 1000, "pk")
	if err := st.put("p1", s); err != nil {
		t.Fatal(err)
	}
	const n = 16
	type result struct {
		token string
		cerr  string
		err   error
	}
	ch := make(chan result, n)
	for i := 0; i < n; i++ {
		go func() {
			next, cerr, err := st.claimPair("p1", "boxed", "phone", 1000)
			ch <- result{token: next.DeviceToken, cerr: cerr, err: err}
		}()
	}
	ok, fail := 0, 0
	var token string
	for i := 0; i < n; i++ {
		r := <-ch
		if r.err != nil {
			t.Fatal(r.err)
		}
		if r.cerr == "" {
			ok++
			token = r.token
		} else {
			if r.cerr != "already claimed" {
				t.Fatalf("cerr %q", r.cerr)
			}
			fail++
		}
	}
	if ok != 1 || fail != n-1 || token == "" {
		t.Fatalf("ok=%d fail=%d", ok, fail)
	}
}
