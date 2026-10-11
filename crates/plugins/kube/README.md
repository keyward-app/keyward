# Kubernetes plugin

**Languages:** English · [Русский](README.ru.md)

This manual belongs to `crates/plugins/kube/`. It documents Kubernetes behavior only; shared Keyward architecture is in the [core guide](../../../docs/core/README.md). The feature is experimental and not an `kubectl` replacement.

## Cluster sources and `kw-*` ownership

The plugin consumes a Kubernetes kubeconfig from a vault note or discovers a cluster on a server reached over SSH. Cloud-provider discovery (EKS and similar) is listed as future work, not a current source.

### Vault-stored kubeconfig

Use a secure note with custom field **`kw-kubeconfig`**. The prefix marks the field as this plugin's schema, avoids colliding with a user's unrelated `config` field and keeps the configuration on the encrypted item that owns it. The imported file's unused contexts are discarded; one explicit/current context is selected and shown before use. The plugin can import `~/.kube/config` or accept pasted YAML, within the 256 KiB limit. Referenced local certificate/key/token files are read during local import and inlined into the selected context so the note is self-contained; the note field must be protected because it may contain credentials/private key material.

### SSH-discovered cluster

The plugin scans SSH destinations represented by vault records. It uses the shared SSH client library directly; the separate SSH plugin UI does not have to be enabled. The source record must have a valid `kw-host` route, SSH key/signing capability and trusted host key. The SSH route/known-host conventions are owned by the [SSH plugin manual](../ssh/README.md). A scan sends an explicit SSH command to inspect likely Kubernetes control-plane configuration. It is never run in the background: the user initiates a full or per-server scan, then opens a discovered cluster to fetch its kubeconfig. The plugin remembers only discovery metadata/status (where, cluster kind, last result, whether sudo is needed); kubeconfig contents are read for an open session, held in memory, and not written as a separate local copy.

The host fingerprint is shown for explicit trust. A failed login, untrusted/changed host key or server refusing the detection command appears as a failed/unknown result; a command-only SSH host is not a cluster.

## Kubeconfig selection and safety checks

The plugin narrows a file to the selected context, referenced cluster and referenced user; unrelated contexts/auth entries are not carried into the client. Before creating a Kubernetes client it refuses:

- non-HTTPS API endpoints and TLS `insecure-skip-tls-verify`;
- proxy URLs;
- kubeconfig `exec` plugins and legacy `auth-provider` handlers (no arbitrary local program execution);
- unsupported remote file paths. For remote sources, referenced CA/cert/key/token files are read on the remote host and inlined; a remote path is never interpreted as a file on the user's Mac.

The API client is reached through the selected source: HTTPS directly for a local kubeconfig, or over the plugin's SSH tunnel for an SSH-discovered cluster. The configured context namespace is used as a default; namespaces can be changed/selected in the UI. Authentication credentials remain in memory for the open cluster session; close it and lock the vault when done.

## What can be inspected

Supported resource kinds: Namespaces, Nodes, Pods, Deployments, StatefulSets, DaemonSets, Services, Ingresses, ConfigMaps, Secrets, Events, Roles, RoleBindings, ClusterRoles, ClusterRoleBindings and NetworkPolicies. Namespaced kinds can be viewed within a namespace or across all namespaces; cluster-scoped kinds are handled at cluster scope.

Lists are purpose-built summaries (for example pod phase/readiness/restarts/node, workload ready/desired counts, service ports, ingress hosts, event reason/message and RBAC rule/member counts), not a general-purpose YAML dump. **Kubernetes Secret values are never listed or opened:** Keyward requests metadata-only lists and refuses Secret manifests. This is deliberate even when the Kubernetes credential itself has broad RBAC rights.

For supported non-Secret resources, the UI can show an object/manifest, edit YAML, create from a form/template, apply changes, delete objects, scale workloads, restart supported workloads, read pod/container logs, and open an interactive shell in a pod/container. Availability still depends on Kubernetes API support and the identity's RBAC permissions. A shell runs inside the selected workload container; commands are executed with that container's service-account/network/filesystem context, not a separate Keyward sandbox.

Apply uses the API server's server-side dry-run first so the UI can show the computed change and the “before/after” result; nothing changes until the user confirms the real apply. Review the rendered diff/manifest, namespace and object identity. Delete, scale, restart, shell, and apply can have production impact. Keyward does not elevate Kubernetes RBAC.

## Connect and operate

1. Unlock the vault and open Kubernetes.
2. Add a kubeconfig by importing local `~/.kube/config`, pasting YAML, or scan SSH-reachable servers. For SSH, check the host fingerprint and approve the exact host; complete any requested user presence/signing prompt.
3. Select/confirm the context. Inspect its API URL and namespace; do not assume the kubeconfig file's other contexts are in use.
4. Open the cluster to establish the API session. Browse namespaces/resources and only perform a mutation after reviewing its preview.
5. Close the cluster session and lock the vault when finished.

Scanning an SSH host is a meaningful action: it signs in, may run a read-only discovery script and can require sudo. Do not approve a host or user prompt you did not initiate. Timeout defaults are bounded (discovery/read and each API request are 20 seconds).

## Permissions, state and privacy

Manifest permissions: `entries`, `items`, `items_write`, `secrets`, `notices`, `ssh_sign`, `network`. These cover finding vault entries/configuration, selecting item details, importing a kubeconfig note, accessing the protected kubeconfig field, reporting events, signing SSH requests via core, and reaching Kubernetes/SSH endpoints. The plugin does not ask for `clipboard`.

Discovery results are non-secret plugin settings. Kubeconfig and credential material are not persisted as a separate local cache after import/open. Network access is disclosed in the manifest but is not technically sandboxed by the core at OS level. Kubernetes RBAC remains the final authority; use a dedicated least-privilege identity, avoid cluster-admin credentials, and audit what the selected context can access.

## Known boundaries

- SSH is the only active remote discovery source; managed cloud-provider sources are future work.
- `exec`, `auth-provider`, proxy URL, plaintext HTTP and skipped TLS verification are refused.
- The plugin is a curated resource console; it does not expose every API kind or arbitrary Kubernetes extension.
- Kubernetes Secret payloads/manifests are intentionally unavailable.
- The project is experimental and unaudited; test against a non-production cluster before enabling mutations.
