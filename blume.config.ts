import { defineConfig, type FolderMetaDefinition } from "blume";

import changelogMetaDefinition from "./docs/changelog/meta";
import guidesMetaDefinition from "./docs/guides/meta";
import referenceMetaDefinition from "./docs/reference/meta";
import sdksMetaDefinition from "./docs/sdks/meta";

const sidebarSection = (
  root: string,
  definition: FolderMetaDefinition,
) => {
  if (typeof definition === "function") {
    throw new TypeError(`Sidebar metadata for ${root} must be static.`);
  }

  return {
    icon: definition.icon,
    items: (definition.pages ?? []).map((page) =>
      page === "index" ? root : `${root}/${page}`,
    ),
    label: definition.title ?? root.slice(1),
    order: definition.order ?? Number.POSITIVE_INFINITY,
    root,
  };
};

const sidebarSections = [
  sidebarSection("/guides", guidesMetaDefinition),
  sidebarSection("/sdks", sdksMetaDefinition),
  sidebarSection("/reference", referenceMetaDefinition),
  sidebarSection("/changelog", changelogMetaDefinition),
]
  .toSorted((a, b) => a.order - b.order)
  .map(({ order: _order, ...section }) => section);

export default defineConfig({
  title: "Distilled",
  description:
    "An Effect-native software factory for type-safe SDKs generated from authoritative API sources.",
  logo: {
    image: "/logo.svg",
    text: "Distilled",
    href: "/",
  },
  banner: {
    content: "Nine Effect-native SDKs, now including TMDB.",
    link: { text: "Read the release", href: "/changelog/v0.7.0" },
    dismissible: true,
    id: "distilled-tmdb-release",
  },
  content: {
    root: "docs",
  },
  github: {
    owner: "kevinmichaelchen",
    repo: "distilled",
    branch: "main",
  },
  lastModified: true,
  navigation: {
    tabs: [
      { label: "Guides", path: "/guides", icon: "book-open" },
      { label: "SDKs", path: "/sdks", icon: "boxes" },
      { label: "Reference", path: "/reference", icon: "braces" },
    ],
    featured: [
      { label: "Blog", href: "/blog", icon: "newspaper" },
    ],
    // Blume excludes sidebar-hidden pages from RSS and other discovery output.
    // Keep blog posts publishable, but omit their section from docs navigation.
    sidebar: {
      display: "group",
      items: ["/", "/inspiration", ...sidebarSections],
    },
  },
  theme: {
    accent: { light: "#0f766e", dark: "#5eead4" },
    action: "#8b5cf6",
    background: { light: "#fbfdfc", dark: "#080b0f" },
    radius: "lg",
    mode: "system",
    fonts: {
      display: "space-grotesk",
      body: "inter",
      mono: "jetbrains-mono",
    },
  },
  search: { provider: "orama" },
  markdown: {
    headingAnchors: true,
    imageZoom: true,
    code: { icons: true, wrap: false },
    codeBlocks: {
      theme: { light: "github-light", dark: "vesper" },
    },
  },
  ai: {
    llmsTxt: { enabled: true },
  },
  export: { pdf: true, epub: true },
  seo: {
    og: { enabled: true },
    rss: { enabled: true, types: ["blog", "changelog"] },
    sitemap: true,
    robots: true,
    structuredData: true,
    agentReadability: true,
  },
  toc: { minHeadingLevel: 2, maxHeadingLevel: 4 },
  deployment: {
    output: "static",
    site: "https://kevinmichaelchen.github.io",
    base: "/distilled",
  },
});
