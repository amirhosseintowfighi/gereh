/* Package mirror (mirror.gereh.net): a caching proxy of the public package registries, so installs and
   builds work during international bandwidth cuts and run at local-network speed. The server side is
   Nexus Repository behind Nginx (deploy/mirror). Shared by the /mirror page, the setup script and the
   Gereh Apps builder. */

export type MirrorEco = {
  id: string; label: string; icon: string; upstream: string;
  /** the repository path on the mirror (Nexus repository name) */
  repo: string;
  snippet: (base: string) => { lang: string; code: string; file?: string };
};

const host = (base: string) => base.replace(/^https?:\/\//, "").replace(/\/$/, "");

export const MIRROR_ECOSYSTEMS: MirrorEco[] = [
  { id: "npm", label: "npm / Yarn / pnpm", icon: "braces", upstream: "registry.npmjs.org", repo: "npm",
    snippet: (b) => ({ lang: "bash", code: `npm config set registry ${b}/repository/npm/\n# Yarn 2+\nyarn config set npmRegistryServer ${b}/repository/npm/\n# pnpm\npnpm config set registry ${b}/repository/npm/` }) },
  { id: "pypi", label: "PyPI (pip / uv / Poetry)", icon: "code-xml", upstream: "pypi.org", repo: "pypi",
    snippet: (b) => ({ lang: "ini", file: "~/.config/pip/pip.conf", code: `[global]\nindex-url = ${b}/repository/pypi/simple\n\n# uv: export UV_INDEX_URL=${b}/repository/pypi/simple` }) },
  { id: "docker", label: "Docker Hub", icon: "box", upstream: "registry-1.docker.io", repo: "docker",
    snippet: (b) => ({ lang: "json", file: "/etc/docker/daemon.json", code: JSON.stringify({ "registry-mirrors": [b] }, null, 2) + "\n\n# sudo systemctl restart docker && docker pull nginx" }) },
  { id: "go", label: "Go modules", icon: "code-xml", upstream: "proxy.golang.org", repo: "go",
    snippet: (b) => ({ lang: "bash", code: `go env -w GOPROXY=${b}/repository/go/,direct` }) },
  { id: "maven", label: "Maven / Gradle", icon: "layers", upstream: "repo1.maven.org", repo: "maven",
    snippet: (b) => ({ lang: "xml", file: "~/.m2/settings.xml", code: `<settings>\n  <mirrors>\n    <mirror>\n      <id>gereh</id>\n      <mirrorOf>central</mirrorOf>\n      <url>${b}/repository/maven/</url>\n    </mirror>\n  </mirrors>\n</settings>` }) },
  { id: "ubuntu", label: "Ubuntu (apt)", icon: "server", upstream: "archive.ubuntu.com", repo: "ubuntu",
    snippet: (b) => ({ lang: "bash", code: `sudo sed -i -E 's#https?://([a-z]+\\.)?(archive|security)\\.ubuntu\\.com/ubuntu/?#${b}/repository/ubuntu/#' \\\n  /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null\nsudo apt update` }) },
  { id: "debian", label: "Debian (apt)", icon: "server", upstream: "deb.debian.org", repo: "debian",
    snippet: (b) => ({ lang: "bash", code: `sudo sed -i -E 's#https?://deb\\.debian\\.org/debian/?#${b}/repository/debian/#' \\\n  /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null\nsudo apt update` }) },
  { id: "alpine", label: "Alpine (apk)", icon: "box", upstream: "dl-cdn.alpinelinux.org", repo: "alpine",
    snippet: (b) => ({ lang: "bash", code: `sed -i 's#https\\?://dl-cdn.alpinelinux.org/alpine#${b}/repository/alpine#' /etc/apk/repositories\napk update` }) },
  { id: "rubygems", label: "RubyGems / Bundler", icon: "gem", upstream: "rubygems.org", repo: "rubygems",
    snippet: (b) => ({ lang: "bash", code: `bundle config set --global mirror.https://rubygems.org ${b}/repository/rubygems/\ngem sources --add ${b}/repository/rubygems/ --remove https://rubygems.org/` }) },
  { id: "nuget", label: "NuGet (.NET)", icon: "layers", upstream: "api.nuget.org", repo: "nuget",
    snippet: (b) => ({ lang: "bash", code: `dotnet nuget add source ${b}/repository/nuget/index.json -n gereh\ndotnet nuget disable source nuget.org` }) },
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
# Gereh package mirror — points apt/apk, Docker, npm, pip and Go on this server at ${b}
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
