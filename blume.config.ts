import { defineConfig } from "blume";

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
    content: "Seven Effect-native API SDKs are live.",
    link: { text: "Explore the catalog", href: "/sdks" },
    dismissible: true,
    id: "distilled-seven-sdks",
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
    sidebar: { display: "group" },
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
