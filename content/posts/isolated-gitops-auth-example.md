---
title: "Worked Example: An Auth Service Across Three Isolated Zones"
date: 2026-09-09
summary: "Companion to the isolated GitOps post. One real service, from source commit to running pod, with the configs at every step."
draft: true
---

Companion piece to [When Your Environments Cannot See Each Other](/posts/isolated-gitops/). That post argues the shape. This one walks a single service through it — an auth service, dev/prod/DR, no route between zones, one transfer.

## Stage 0: the two repos

**Source repo** `platform-config`, on the connected side. The only thing shared between environments.

```
platform-config/
├── charts/
│   └── auth/
│       ├── Chart.yaml
│       ├── values.yaml              # true in every zone
│       └── templates/
│           ├── deployment.yaml
│           ├── service.yaml
│           ├── ingress.yaml
│           └── externalsecret.yaml
├── environments/
│   ├── dev/{env.yaml,values-auth.yaml}
│   ├── prod/{env.yaml,values-auth.yaml}
│   ├── dr/{env.yaml,values-auth.yaml}
│   └── images.lock
└── ci/render.sh
```

**Delivery repo** `rendered`, one per zone, on that zone's own Git server. Nothing writes to it except the import step.

```
rendered/
└── services/
    └── auth/
        └── manifests.yaml
```

Chart dependencies are vendored under `charts/auth/charts/`, not declared as remote repos. Nothing resolves at render time either — CI is connected, but a live pull makes the render non-reproducible, which defeats the point.

```yaml
# charts/auth/Chart.yaml
apiVersion: v2
name: auth
version: 1.8.0
appVersion: "2.4.0"
```

## Stage 1: the base, what is true in every zone

```yaml
# charts/auth/values.yaml
replicas: 2
image:
  repository: platform/auth
  digest: ""            # required, injected per env
registry: ""            # required, injected per env
service:
  port: 8080
tokenTTL: 15m
refreshTokenRotation: true
oidc:
  realmPath: /auth/realms/platform
secretRef: auth-runtime  # materialised in-zone, never rendered
resources:
  requests: { cpu: 200m, memory: 256Mi }
  limits:   { memory: 512Mi }
provenance:
  commit: ""            # required
```

Token TTL and refresh rotation are auth *behaviour*. Same in all three zones or dev stops testing prod. Replica count, database host and ingress are not.

## Stage 2: the per-zone inputs

```yaml
# environments/prod/env.yaml
registry: registry.prod.internal
repoURL: https://git.prod.internal/platform/rendered.git
```

```yaml
# environments/prod/values-auth.yaml
replicas: 6
ingress:
  host: auth.prod.internal
  className: nginx-internal
db:
  host: auth-db.prod.internal
  sslMode: verify-full
oidc:
  issuerUrl: https://auth.prod.internal/auth/realms/platform
```

```yaml
# environments/dr/values-auth.yaml
replicas: 2
ingress:
  host: auth.dr.internal
  className: nginx-internal
db:
  host: auth-db.dr.internal
  sslMode: verify-full
oidc:
  issuerUrl: https://auth.dr.internal/auth/realms/platform
```

```yaml
# environments/images.lock
auth: sha256:4c2a91f0d3b8e7a5c1049f6b2e8d3a7c5b9e1f04d6a8c2b7e5f3a1d9c0b4e6f28
```

One lock file, not three. The digest is a property of the image, not of the zone — only the registry host varies, and that lives in `env.yaml`. Every difference between prod and DR is now four lines you can diff. No `if` anywhere.

## Stage 3: render, on the connected side

```bash
#!/usr/bin/env bash
# ci/render.sh
set -euo pipefail
ENV="$1"
SHA="$(git rev-parse HEAD)"
OUT="out/${ENV}/services/auth"
mkdir -p "$OUT"

REGISTRY="$(yq -r '.registry' "environments/${ENV}/env.yaml")"
DIGEST="$(yq -r '.auth'       environments/images.lock)"

render() {
  helm template auth charts/auth \
    --namespace auth \
    --kube-version 1.31 \
    --api-versions external-secrets.io/v1beta1 \
    -f charts/auth/values.yaml \
    -f "environments/${ENV}/values-auth.yaml" \
    --set registry="$REGISTRY" \
    --set image.digest="$DIGEST" \
    --set provenance.commit="$SHA"
}

render > "${OUT}/manifests.yaml"
render | diff -u "${OUT}/manifests.yaml" - \
  || { echo "render is not deterministic"; exit 1; }

kubeconform -strict -summary "${OUT}/manifests.yaml"
conftest test "${OUT}/manifests.yaml"
```

Three things earn their place here.

`--kube-version` and `--api-versions` are mandatory. There is no cluster to ask, so any `.Capabilities` lookup needs the answer supplied. Skip them and the render silently drops the `ExternalSecret`.

Rendering twice and diffing is the determinism gate. Charts that call `randAlphaNum`, `lookup` or `now` produce a different result every run, which turns the approver's diff into noise and makes "identical bytes" false. Catching that in CI costs one extra render.

`required` in the template makes a missing digest a CI failure on the connected side, where failure is cheap.

```yaml
# charts/auth/templates/deployment.yaml, the part that matters
    spec:
      containers:
        - name: auth
          image: "{{ required "registry required" .Values.registry }}/{{ .Values.image.repository }}@{{ required "image digest required" .Values.image.digest }}"
          env:
            - name: OIDC_ISSUER_URL
              value: {{ .Values.oidc.issuerUrl | quote }}
            - name: DB_HOST
              value: {{ .Values.db.host | quote }}
            - name: TOKEN_TTL
              value: {{ .Values.tokenTTL | quote }}
            - name: REFRESH_TOKEN_ROTATION
              value: {{ .Values.refreshTokenRotation | quote }}
          envFrom:
            - secretRef:
                name: {{ .Values.secretRef }}
```

Plus a provenance annotation, which is what makes the chain auditable from inside the zone:

```yaml
  annotations:
    platform.internal/source-commit: {{ .Values.provenance.commit | quote }}
    platform.internal/chart: "auth-{{ .Chart.Version }}"
```

Now this answers "what built the thing that is running" from a cluster with no route to the source repo:

```
kubectl -n auth get deploy auth \
  -o jsonpath='{.metadata.annotations.platform\.internal/source-commit}'
```

Output for prod:

```yaml
# out/prod/services/auth/manifests.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth
  namespace: auth
  annotations:
    platform.internal/source-commit: "4f9c2ab8d1e05c3fa7b2..."
    platform.internal/chart: "auth-1.8.0"
  labels:
    app.kubernetes.io/name: auth
    app.kubernetes.io/version: "2.4.0"
spec:
  replicas: 6
  ...
        - name: auth
          image: registry.prod.internal/platform/auth@sha256:4c2a91f0d3b8...
```

## Stage 4: ordering, because auth has a schema

An auth service has a database, so it has migrations, and a rendered `Job` with a fixed name fails on the second sync because a Job's spec is immutable. Sync waves and hook policy handle both that and the CRD ordering problem:

```yaml
# charts/auth/templates/migrate-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: auth-migrate
  namespace: auth
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
```

The `ExternalSecret` needs to exist before the Deployment starts, so it renders one wave earlier:

```yaml
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
```

Without that the pods sit in `CreateContainerConfigError` until External Secrets Operator catches up. Not fatal, but it looks like an outage on every first sync.

## Stage 5: secrets never cross

The auth service needs a JWT signing key and a database password. Neither goes in the bundle. What renders is a reference:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: auth-runtime
  namespace: auth
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: zone-vault
    kind: ClusterSecretStore
  target:
    name: auth-runtime
  data:
    - secretKey: JWT_SIGNING_KEY
      remoteRef: { key: platform/auth, property: jwt_signing_key }
    - secretKey: DB_PASSWORD
      remoteRef: { key: platform/auth, property: db_password }
```

Byte-identical in all three zones. The values behind it differ per zone and are populated by that zone's own Vault. For an auth service that is not just hygiene: a prod-signed token must not validate in DR, so the signing keys have to differ by design. The manifest says *which* key to load, never *what* it is.

The `ClusterSecretStore` and External Secrets Operator itself are zone infrastructure, installed from the platform bundle before any service bundle lands. They are not part of this Application.

## Stage 6: two bundles, in a fixed order

The manifests reference an image by digest. If that image is not in the zone registry, the Deployment lands and sits in `ImagePullBackOff`. Image first.

```bash
# connected side
skopeo copy --all --preserve-digests \
  docker://registry.connected.internal/platform/auth@sha256:4c2a91f0d3b8... \
  dir:./auth-2.4.0

tar -czf image-auth-2.4.0.tar.gz auth-2.4.0/
tar -czf manifests-prod-4f9c2ab.tar.gz -C out/prod .

cosign sign-blob --key platform.key manifests-prod-4f9c2ab.tar.gz \
  > manifests-prod-4f9c2ab.sig
```

`--all` and `--preserve-digests` are load-bearing. Without `--all`, a multi-arch image collapses to a single platform and the resulting digest no longer matches the one in `images.lock` — a failure that shows up after the transfer, which is the worst place to find it.

## Stage 7: what the approver actually sees

CI also emits the diff against what prod is running today. For the 2.3.1 to 2.4.0 bump:

```diff
--- rendered/services/auth/manifests.yaml
+++ out/prod/services/auth/manifests.yaml
   labels:
-    app.kubernetes.io/version: "2.3.1"
+    app.kubernetes.io/version: "2.4.0"
   annotations:
-    platform.internal/source-commit: "a71e93c..."
+    platform.internal/source-commit: "4f9c2ab..."
-          image: registry.prod.internal/platform/auth@sha256:9b1e07...
+          image: registry.prod.internal/platform/auth@sha256:4c2a91...
             - name: TOKEN_TTL
-              value: "60m"
+              value: "15m"
+            - name: REFRESH_TOKEN_ROTATION
+              value: "true"
```

That is the argument for the whole pattern in one screen. The TTL drop from 60m to 15m and the new rotation flag are auth behaviour changes that will log every existing session out. The approver sees them, in the same diff as the version bump, before anything crosses.

## Stage 8: import, inside the zone

Run by an operator on the inside. It is the only write into the delivery repo.

```bash
set -euo pipefail

cosign verify-blob --key /etc/keys/platform.pub \
  --signature manifests-prod-4f9c2ab.sig manifests-prod-4f9c2ab.tar.gz

# image first, and verify the digest survived the trip
tar -xzf image-auth-2.4.0.tar.gz
skopeo copy --all --preserve-digests dir:./auth-2.4.0 \
  docker://registry.prod.internal/platform/auth:2.4.0

LANDED="$(skopeo inspect --format '{{.Digest}}' \
  docker://registry.prod.internal/platform/auth:2.4.0)"
grep -q "$LANDED" manifests-prod-4f9c2ab/services/auth/manifests.yaml \
  || { echo "digest mismatch, refusing to push"; exit 1; }

git clone https://git.prod.internal/platform/rendered.git
tar -xzf manifests-prod-4f9c2ab.tar.gz -C rendered/
cd rendered
git add -A
git commit -m "prod: import 4f9c2ab (auth 2.3.1 -> 2.4.0)"
git push
```

The digest check turns a post-transfer outage into a pre-push failure. Nothing has been handed to Argo CD yet at that point, so the cost of being wrong is a re-transfer instead of an incident.

## Stage 9: Argo CD, with no further human involved

The ApplicationSet from the main post sees `services/auth/` and generates:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: auth
  namespace: argocd
spec:
  project: services
  source:
    repoURL: https://git.prod.internal/platform/rendered.git
    targetRevision: main
    path: services/auth
  destination:
    server: https://kubernetes.default.svc
    namespace: auth
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

Within the poll interval it applies `manifests.yaml`. No templating, no chart fetch, no credentials for any other cluster. The bytes applied are the bytes signed.

One detail that bites: the rendered manifests already carry `namespace: auth`, set by `helm template --namespace`. That must match the ApplicationSet's `{{.path.basename}}`-derived destination namespace, or Argo CD applies into the manifest's namespace while reporting the Application's, and the two quietly disagree. Directory name equals namespace is the rule that keeps it honest; a `conftest` rule enforcing it at render time keeps it true.

## Stage 10: rollback, which is not a sync click

Prod runs auto-sync, so `argocd app rollback` is refused — Argo CD will not roll back an app with automated sync enabled. That is fine, because the delivery repo already holds every previous state:

```bash
git -C rendered revert --no-edit HEAD
git -C rendered push
```

Auto-sync picks up the revert on the next poll and the previous manifests are back, with no transfer and no approval cycle. This is the one legitimate in-zone write besides import, and it needs to be a named break-glass path with its own group and its own audit trail — not something everyone with a shell can do.

Note what rollback does *not* fix: the image. A revert restores the previous digest, which is still in the zone registry as long as nothing garbage-collected it. Registry retention in each zone is therefore part of the rollback plan, not a housekeeping detail.

## What DR gets

Same command, one argument changed:

```bash
./ci/render.sh dr    # same HEAD, environments/dr/*
```

Separate bundle, separate approval, separate transfer. Then the question that actually matters at 3am is a shell command:

```bash
diff <(yq -P 'select(.kind=="Deployment")' prod/services/auth/manifests.yaml) \
     <(yq -P 'select(.kind=="Deployment")' dr/services/auth/manifests.yaml)
```

```diff
-  replicas: 6
+  replicas: 2
-          value: "auth-db.prod.internal"
+          value: "auth-db.dr.internal"
```

Two lines. Same image digest, same TTL, same rotation flag. That is what "DR is prod with different inputs" looks like when it is true, and the diff is what proves it.

Nothing enforces it, though. Prod and DR are two independent approvals, and if one is held while the other lands, they diverge silently. The cheap guard is an import-time assertion: refuse the push if the incoming bundle's source commit is older than what the sibling zone last recorded, and surface the gap somewhere a human reads.
