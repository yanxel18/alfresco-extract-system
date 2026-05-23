import { createTheme, MantineColorsTuple } from "@mantine/core";

const brand: MantineColorsTuple = [
  "#eef3ff",
  "#dce5ff",
  "#b9c9ff",
  "#93abff",
  "#7191ff",
  "#5a7eff",
  "#4c73ff",
  "#3c61e8",
  "#3356d0",
  "#264bba",
];

export const theme = createTheme({
  primaryColor: "brand",
  colors: { brand },
  fontFamily:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: {
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontWeight: "600",
  },
  defaultRadius: "md",
  components: {
    Button: { defaultProps: { radius: "md" } },
    Card: { defaultProps: { radius: "md", shadow: "sm", withBorder: true } },
    Paper: { defaultProps: { radius: "md" } },
    Badge: { defaultProps: { radius: "sm" } },
  },
});
