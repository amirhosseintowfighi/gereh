/* Package mirror (mirror.gereh.net): a caching proxy of the public package registries, so installs and
   builds work during international bandwidth cuts and run at local-network speed. The server side is
   Nexus Repository behind Nginx (deploy/mirror). Shared by the /mirror page, the setup script and the
   Gereh Apps builder. */

export type MirrorGroup = "distro" | "registry" | "package";
export const MIRROR_GROUPS: { id: MirrorGroup; label: string; sub: string }[] = [
  { id: "package", label: "مدیران بسته", sub: "npm، PyPI، Composer، Go، NuGet، Maven، RubyGems و crates.io" },
  { id: "registry", label: "رجیستری‌های کانتینر", sub: "Docker Hub، GHCR، Quay، registry.k8s.io و MCR" },
  { id: "distro", label: "توزیع‌های لینوکس", sub: "مخازن apt، dnf، zypper، apk و pacman" },
];

export type MirrorEco = {
  id: string; label: string; icon: string; upstream: string; group: MirrorGroup;
  /** the repository path on the mirror (Nexus repository name) */
  repo: string;
  snippet: (base: string) => { lang: string; code: string; file?: string };
};

const host = (base: string) => base.replace(/^https?:\/\//, "").replace(/\/$/, "");
/** other registries are reached as <mirror>/<prefix>/<image>; Docker and containerd snippets */
const registry = (id: string, upstream: string, example: string) => (b: string) => ({
  lang: "bash",
  code: `# docker / podman: ${upstream}/${example} →\ndocker pull ${host(b)}/${id}/${example}\n\n# containerd (Kubernetes nodes): /etc/containerd/certs.d/${upstream}/hosts.toml\nsudo mkdir -p /etc/containerd/certs.d/${upstream}\nsudo tee /etc/containerd/certs.d/${upstream}/hosts.toml <<'EOF'\nserver = "https://${upstream}"\n[host."${b}/v2/${id}"]\n  capabilities = ["pull", "resolve"]\n  override_path = true\nEOF`,
});
/* RPM distros: the mirror URL replaces the commented baseurl and the metalink/mirrorlist is disabled */
const rpm = (files: string, from: string, repo: string) => (b: string) => ({
  lang: "bash",
  code: `sudo sed -i -e 's|^metalink=|#metalink=|' -e 's|^mirrorlist=|#mirrorlist=|' \\\n  -e 's|^#\\s*baseurl=${from}|baseurl=${b}/repository/${repo}|' \\\n  ${files}\nsudo dnf clean all && sudo dnf makecache`,
});

export const MIRROR_ECOSYSTEMS: MirrorEco[] = [
  /* ---------- package managers ---------- */
  { id: "npm", label: "npm / Yarn / pnpm", icon: "braces", upstream: "registry.npmjs.org", repo: "npm", group: "package",
    snippet: (b) => ({ lang: "bash", code: `npm config set registry ${b}/repository/npm/\n# Yarn 2+\nyarn config set npmRegistryServer ${b}/repository/npm/\n# pnpm\npnpm config set registry ${b}/repository/npm/\n# Bun: bunfig.toml → [install] registry = "${b}/repository/npm/"` }) },
  { id: "pypi", label: "PyPI (pip / uv / Poetry)", icon: "code-xml", upstream: "pypi.org", repo: "pypi", group: "package",
    snippet: (b) => ({ lang: "ini", file: "~/.config/pip/pip.conf", code: `[global]\nindex-url = ${b}/repository/pypi/simple\n\n# uv: export UV_INDEX_URL=${b}/repository/pypi/simple\n# Poetry: poetry source add --priority=primary gereh ${b}/repository/pypi/simple` }) },
  { id: "composer", label: "Composer (PHP)", icon: "code-xml", upstream: "repo.packagist.org", repo: "composer", group: "package",
    snippet: (b) => ({ lang: "bash", code: `composer config -g repos.packagist composer ${b}/repository/composer/\n# فقط برای یک پروژه: بدون -g در پوشه پروژه` }) },
  { id: "go", label: "Go modules", icon: "code-xml", upstream: "proxy.golang.org", repo: "go", group: "package",
    snippet: (b) => ({ lang: "bash", code: `go env -w GOPROXY=${b}/repository/go/,direct` }) },
  { id: "nuget", label: "NuGet (.NET)", icon: "layers", upstream: "api.nuget.org", repo: "nuget", group: "package",
    snippet: (b) => ({ lang: "bash", code: `dotnet nuget add source ${b}/repository/nuget/index.json -n gereh\ndotnet nuget disable source nuget.org` }) },
  { id: "maven", label: "Maven / Gradle", icon: "layers", upstream: "repo1.maven.org", repo: "maven", group: "package",
    snippet: (b) => ({ lang: "xml", file: "~/.m2/settings.xml", code: `<settings>\n  <mirrors>\n    <mirror>\n      <id>gereh</id>\n      <mirrorOf>central</mirrorOf>\n      <url>${b}/repository/maven/</url>\n    </mirror>\n  </mirrors>\n</settings>\n\n<!-- Gradle (settings.gradle.kts): repositories { maven("${b}/repository/maven/") } -->` }) },
  { id: "rubygems", label: "RubyGems / Bundler", icon: "gem", upstream: "rubygems.org", repo: "rubygems", group: "package",
    snippet: (b) => ({ lang: "bash", code: `bundle config set --global mirror.https://rubygems.org ${b}/repository/rubygems/\ngem sources --add ${b}/repository/rubygems/ --remove https://rubygems.org/` }) },
  { id: "crates", label: "crates.io (Cargo)", icon: "package-open", upstream: "index.crates.io", repo: "crates", group: "package",
    snippet: (b) => ({ lang: "toml", file: "~/.cargo/config.toml", code: `[source.crates-io]\nreplace-with = "gereh"\n\n[source.gereh]\nregistry = "sparse+${b}/repository/crates/"` }) },

  /* ---------- container registries ---------- */
  { id: "docker", label: "Docker Hub", icon: "box", upstream: "registry-1.docker.io", repo: "docker", group: "registry",
    snippet: (b) => ({ lang: "json", file: "/etc/docker/daemon.json", code: JSON.stringify({ "registry-mirrors": [b] }, null, 2) + "\n\n# sudo systemctl restart docker && docker pull nginx" }) },
  { id: "ghcr", label: "GitHub Container Registry", icon: "box", upstream: "ghcr.io", repo: "ghcr", group: "registry", snippet: registry("ghcr", "ghcr.io", "home-assistant/home-assistant:stable") },
  { id: "quay", label: "Quay.io", icon: "box", upstream: "quay.io", repo: "quay", group: "registry", snippet: registry("quay", "quay.io", "prometheus/node-exporter:latest") },
  { id: "k8s", label: "registry.k8s.io (Kubernetes)", icon: "box", upstream: "registry.k8s.io", repo: "k8s", group: "registry", snippet: registry("k8s", "registry.k8s.io", "pause:3.10") },
  { id: "mcr", label: "Microsoft (MCR)", icon: "box", upstream: "mcr.microsoft.com", repo: "mcr", group: "registry", snippet: registry("mcr", "mcr.microsoft.com", "dotnet/aspnet:8.0") },

  /* ---------- Linux distributions ---------- */
  { id: "ubuntu", label: "Ubuntu (apt)", icon: "server", upstream: "archive.ubuntu.com", repo: "ubuntu", group: "distro",
    snippet: (b) => ({ lang: "bash", code: `sudo sed -i -E 's#https?://([a-z]+\\.)?(archive|security)\\.ubuntu\\.com/ubuntu/?#${b}/repository/ubuntu/#' \\\n  /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null\nsudo apt update` }) },
  { id: "debian", label: "Debian (apt)", icon: "server", upstream: "deb.debian.org", repo: "debian", group: "distro",
    snippet: (b) => ({ lang: "bash", code: `sudo sed -i -E 's#https?://deb\\.debian\\.org/debian/?#${b}/repository/debian/#' \\\n  /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null\nsudo apt update` }) },
  { id: "fedora", label: "Fedora (dnf)", icon: "server", upstream: "dl.fedoraproject.org", repo: "fedora", group: "distro",
    snippet: rpm("/etc/yum.repos.d/fedora*.repo", "http://download.example/pub/fedora/linux", "fedora") },
  { id: "centos", label: "CentOS Stream (dnf)", icon: "server", upstream: "mirror.stream.centos.org", repo: "centos", group: "distro",
    snippet: (b) => ({ lang: "bash", code: `sudo sed -i 's/^enabled=1/enabled=0/' /etc/yum.repos.d/centos.repo\nsudo tee /etc/yum.repos.d/gereh.repo <<'EOF'\n[gereh-baseos]\nname=CentOS Stream $releasever - BaseOS (Gereh)\nbaseurl=${b}/repository/centos/$releasever-stream/BaseOS/$basearch/os/\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial\n\n[gereh-appstream]\nname=CentOS Stream $releasever - AppStream (Gereh)\nbaseurl=${b}/repository/centos/$releasever-stream/AppStream/$basearch/os/\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial\nEOF\nsudo dnf makecache` }) },
  { id: "rocky", label: "Rocky Linux (dnf)", icon: "server", upstream: "dl.rockylinux.org", repo: "rocky", group: "distro",
    snippet: rpm("/etc/yum.repos.d/[Rr]ocky*.repo", "http://dl.rockylinux.org/$contentdir", "rocky") },
  { id: "almalinux", label: "AlmaLinux (dnf)", icon: "server", upstream: "repo.almalinux.org", repo: "almalinux", group: "distro",
    snippet: rpm("/etc/yum.repos.d/almalinux*.repo", "https://repo.almalinux.org/almalinux", "almalinux") },
  { id: "opensuse", label: "openSUSE (zypper)", icon: "server", upstream: "download.opensuse.org", repo: "opensuse", group: "distro",
    snippet: (b) => ({ lang: "bash", code: `sudo sed -i -E 's#https?://(download|cdn)\\.opensuse\\.org#${b}/repository/opensuse#' /etc/zypp/repos.d/*.repo\nsudo zypper refresh` }) },
  { id: "alpine", label: "Alpine (apk)", icon: "box", upstream: "dl-cdn.alpinelinux.org", repo: "alpine", group: "distro",
    snippet: (b) => ({ lang: "bash", code: `sed -i 's#https\\?://dl-cdn.alpinelinux.org/alpine#${b}/repository/alpine#' /etc/apk/repositories\napk update` }) },
  { id: "arch", label: "Arch Linux (pacman)", icon: "server", upstream: "geo.mirror.pkgbuild.com", repo: "archlinux", group: "distro",
    snippet: (b) => ({ lang: "bash", file: "/etc/pacman.d/mirrorlist", code: `sudo sed -i '1i Server = ${b}/repository/archlinux/$repo/os/$arch' /etc/pacman.d/mirrorlist\nsudo pacman -Syy` }) },
  { id: "manjaro", label: "Manjaro (pacman)", icon: "server", upstream: "repo.manjaro.org", repo: "manjaro", group: "distro",
    snippet: (b) => ({ lang: "bash", file: "/etc/pacman.d/mirrorlist", code: `sudo sed -i '1i Server = ${b}/repository/manjaro/stable/$repo/$arch' /etc/pacman.d/mirrorlist\nsudo pacman -Syy` }) },
];

/** environment a build (or a shell) uses so package managers go through the mirror */
export function mirrorEnv(base: string): Record<string, string> {
  const b = base.replace(/\/$/, "");
  return {
    NPM_CONFIG_REGISTRY: b + "/repository/npm/",
    YARN_NPM_REGISTRY_SERVER: b + "/repository/npm/",
    PIP_INDEX_URL: b + "/repository/pypi/simple",
    UV_INDEX_URL: b + "/repository/pypi/simple",
    GOPROXY: b + "/repository/go/,direct",
  };
}
export const mirrorHost = host;

/** shell script that points a fresh server at the mirror (served at /mirror/setup.sh) */
export function mirrorSetupScript(base: string, site: string) {
  const b = base.replace(/\/$/, ""), env = mirrorEnv(b);
  return `#!/bin/sh
# Gereh package mirror — points apt/dnf/zypper/apk/pacman, Docker, npm, pip and Go on this server at ${b}
# usage: curl -fsSL ${site.replace(/\/$/, "")}/mirror/setup.sh | sudo sh
set -eu
M=${b}
echo "==> Gereh mirror: $M"
if [ -f /etc/os-release ]; then . /etc/os-release; fi
case "\${ID:-}" in
  ubuntu)
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
      if [ -f "$f" ]; then sed -i -E "s#https?://([a-z]+\\.)?(archive|security)\\.ubuntu\\.com/ubuntu/?#$M/repository/ubuntu/#g" "$f"; fi
    done; echo "   apt (ubuntu) ✓" ;;
  debian)
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
      if [ -f "$f" ]; then sed -i -E "s#https?://deb\\.debian\\.org/debian/?#$M/repository/debian/#g" "$f"; fi
    done; echo "   apt (debian) ✓" ;;
  alpine)
    sed -i "s#https\\?://dl-cdn.alpinelinux.org/alpine#$M/repository/alpine#" /etc/apk/repositories; echo "   apk ✓" ;;
  fedora)
    sed -i -e 's|^metalink=|#metalink=|' -e "s|^#\\s*baseurl=http://download.example/pub/fedora/linux|baseurl=$M/repository/fedora|" /etc/yum.repos.d/fedora*.repo; echo "   dnf (fedora) ✓" ;;
  rocky)
    sed -i -e 's|^mirrorlist=|#mirrorlist=|' -e "s|^#\\s*baseurl=http://dl.rockylinux.org/\\$contentdir|baseurl=$M/repository/rocky|" /etc/yum.repos.d/[Rr]ocky*.repo; echo "   dnf (rocky) ✓" ;;
  almalinux)
    sed -i -e 's|^mirrorlist=|#mirrorlist=|' -e "s|^#\\s*baseurl=https://repo.almalinux.org/almalinux|baseurl=$M/repository/almalinux|" /etc/yum.repos.d/almalinux*.repo; echo "   dnf (almalinux) ✓" ;;
  opensuse*|sles)
    sed -i -E "s#https?://(download|cdn)\\.opensuse\\.org#$M/repository/opensuse#" /etc/zypp/repos.d/*.repo; echo "   zypper ✓" ;;
  arch)
    grep -q "$M" /etc/pacman.d/mirrorlist || sed -i "1i Server = $M/repository/archlinux/\\$repo/os/\\$arch" /etc/pacman.d/mirrorlist; echo "   pacman (arch) ✓" ;;
  manjaro)
    grep -q "$M" /etc/pacman.d/mirrorlist || sed -i "1i Server = $M/repository/manjaro/stable/\\$repo/\\$arch" /etc/pacman.d/mirrorlist; echo "   pacman (manjaro) ✓" ;;
esac
if command -v docker >/dev/null 2>&1 || [ -d /etc/docker ]; then
  mkdir -p /etc/docker
  if [ -s /etc/docker/daemon.json ] && ! grep -q registry-mirrors /etc/docker/daemon.json; then
    echo "   docker: /etc/docker/daemon.json exists; add \\"registry-mirrors\\": [\\"$M\\"] by hand"
  elif [ ! -s /etc/docker/daemon.json ]; then
    printf '{\\n  "registry-mirrors": ["%s"]\\n}\\n' "$M" > /etc/docker/daemon.json
    (systemctl restart docker 2>/dev/null || true); echo "   docker ✓"
  fi
fi
cat > /etc/profile.d/gereh-mirror.sh <<EOF
${Object.entries(env).map(([k, v]) => "export " + k + "=" + v).join("\n")}
EOF
printf '[global]\\nindex-url = %s/repository/pypi/simple\\n' "$M" > /etc/pip.conf
echo "   npm, pip, uv, Go (new shells) ✓"
echo "==> Done. Open a new shell (or: . /etc/profile.d/gereh-mirror.sh)"
`;
}
