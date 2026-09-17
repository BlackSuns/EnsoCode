package main

import "testing"

func TestPairIDFromPublicKey(t *testing.T) {
	if pairIDFromPublicKey("abc123") != pairIDFromPublicKey("abc123") {
		t.Fatal("same public key must map to the same pairId")
	}
	if pairIDFromPublicKey("a") == pairIDFromPublicKey("b") {
		t.Fatal("different public keys must map to different pairIds")
	}
	if got, want := pairIDFromPublicKey("abc123"), "bKE9UspwyIPg8LsQHkJaiQ"; got != want {
		t.Fatalf("pairId abc123: got %q want %q", got, want)
	}
	if got, want := pairIDFromPublicKey("a"), "ypeBEsobvcr6wjGzmiPcTQ"; got != want {
		t.Fatalf("pairId a: got %q want %q", got, want)
	}
	if got, want := pairIDFromPublicKey("b"), "PiPoFgA5WUoziU9lZOGxNA"; got != want {
		t.Fatalf("pairId b: got %q want %q", got, want)
	}
}

func TestRequestCreatesRequested(t *testing.T) {
	s, changed := request(nil, 1000, "pk")
	if !changed {
		t.Fatal("expected new state")
	}
	if s.Phase != pairPhaseRequested || s.HostPublicKey != "pk" || s.CreatedAt != 1000 {
		t.Fatalf("unexpected state %#v", s)
	}
}

func TestRequestIdempotent(t *testing.T) {
	s, _ := request(nil, 1000, "pk")
	s2, changed := request(&s, 6000, "pk")
	if changed {
		t.Fatal("unexpired request must not rewrite")
	}
	if s2 != s {
		t.Fatalf("got %#v want %#v", s2, s)
	}
}

func TestRequestRebuildsAfterExpiry(t *testing.T) {
	s, _ := request(nil, 1000, "pk")
	s2, changed := request(&s, 1000+pairTTLMS+1, "pk")
	if !changed {
		t.Fatal("expired request must rebuild")
	}
	if s2.CreatedAt <= s.CreatedAt {
		t.Fatalf("new createdAt %d should be greater than %d", s2.CreatedAt, s.CreatedAt)
	}
}

func TestClaimRequiresRequested(t *testing.T) {
	if claim(nil, 1000, "boxed", "iphone").ok {
		t.Fatal("claim without pending pair must fail")
	}
}

func TestClaimSuccess(t *testing.T) {
	s, _ := request(nil, 1000, "pk")
	res := claim(&s, 1000, "boxed", "iphone")
	if !res.ok {
		t.Fatalf("claim failed: %s", res.error)
	}
	if res.next.Phase != pairPhaseAuthorized {
		t.Fatalf("phase %q", res.next.Phase)
	}
	if res.next.BoxedKey != "boxed" || res.next.DeviceName != "iphone" {
		t.Fatalf("unexpected %#v", res.next)
	}
	if res.next.HostToken == "" || res.next.DeviceToken == "" {
		t.Fatal("tokens must be issued")
	}
	if res.next.HostToken == res.next.DeviceToken {
		t.Fatal("host and device tokens must differ")
	}
	if res.next.AuthorizedAt != 1000 {
		t.Fatalf("authorizedAt %d", res.next.AuthorizedAt)
	}
}

func TestClaimOnce(t *testing.T) {
	s, _ := request(nil, 1000, "pk")
	first := claim(&s, 1000, "boxed", "a")
	if !first.ok {
		t.Fatal(first.error)
	}
	second := claim(&first.next, 1000, "boxed2", "b")
	if second.ok {
		t.Fatal("second claim must be rejected")
	}
	if second.error != "already claimed" {
		t.Fatalf("error %q", second.error)
	}
}

func TestClaimExpired(t *testing.T) {
	s, _ := request(nil, 1000, "pk")
	res := claim(&s, 1000+pairTTLMS+1, "boxed", "a")
	if res.ok {
		t.Fatal("expired claim must fail")
	}
	if res.error != "pair code expired" {
		t.Fatalf("error %q", res.error)
	}
}

func TestTokenValid(t *testing.T) {
	s, _ := request(nil, 1000, "pk")
	res := claim(&s, 1000, "boxed", "a")
	if !res.ok {
		t.Fatal(res.error)
	}
	st := res.next
	if !tokenValid(&st, roleHost, st.HostToken) {
		t.Fatal("host token should pass")
	}
	if !tokenValid(&st, roleGuest, st.DeviceToken) {
		t.Fatal("guest token should pass")
	}
	if tokenValid(&st, roleHost, st.DeviceToken) {
		t.Fatal("role mismatch must fail")
	}
	if tokenValid(&st, roleGuest, "wrong") {
		t.Fatal("wrong token must fail")
	}
	if tokenValid(&st, roleHost, "") {
		t.Fatal("empty token must fail")
	}
	req, _ := request(nil, 1000, "pk")
	if tokenValid(&req, roleHost, "x") {
		t.Fatal("requested phase must reject tokens")
	}
}

func TestCredentialWindow(t *testing.T) {
	s, _ := request(nil, 1000, "pk")
	res := claim(&s, 1000, "boxed", "phone")
	if !res.ok {
		t.Fatal(res.error)
	}
	st := res.next
	if !canFetchCredentials(st, 1000) {
		t.Fatal("window start must allow fetch")
	}
	if !canFetchCredentials(st, 1000+credentialWindowMS) {
		t.Fatal("window end must allow fetch")
	}
	if canFetchCredentials(st, 1000+credentialWindowMS+1) {
		t.Fatal("after window must deny fetch")
	}
	if canFetchCredentials(st, 1000+86_400_000) {
		t.Fatal("long after window must deny fetch")
	}
	req, _ := request(nil, 1000, "pk")
	if canFetchCredentials(req, 1000) {
		t.Fatal("requested has no credentials")
	}
	if !tokenValid(&st, roleHost, st.HostToken) || !tokenValid(&st, roleGuest, st.DeviceToken) {
		t.Fatal("closed window must still accept existing tokens")
	}
}

func TestNormalizeDeviceName(t *testing.T) {
	if got := normalizeDeviceName(""); got != "phone" {
		t.Fatalf("empty: %q", got)
	}
	long := make([]rune, 80)
	for i := range long {
		long[i] = 'a'
	}
	if got := normalizeDeviceName(string(long)); len([]rune(got)) != 64 {
		t.Fatalf("len %d", len([]rune(got)))
	}
}

func TestRandomTokenShape(t *testing.T) {
	seen := map[string]struct{}{}
	for i := 0; i < 64; i++ {
		tok := randomToken()
		if len(tok) != 32 {
			t.Fatalf("len %d token %q", len(tok), tok)
		}
		if _, ok := seen[tok]; ok {
			t.Fatal("token collision")
		}
		seen[tok] = struct{}{}
	}
}
