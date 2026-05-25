import { theme } from "@/theme";

describe("theme", () => {
  it("defines the custom brand palette and defaults", () => {
    expect(theme.primaryColor).toBe("brand");
    expect(theme.colors?.brand).toHaveLength(10);
    expect(theme.defaultRadius).toBe("md");
    expect(theme.fontFamily).toContain("Inter");
    expect(theme.headings?.fontWeight).toBe("600");
    expect(theme.components?.Button?.defaultProps).toEqual({ radius: "md" });
    expect(theme.components?.Card?.defaultProps).toEqual({
      radius: "md",
      shadow: "sm",
      withBorder: true,
    });
    expect(theme.components?.Paper?.defaultProps).toEqual({ radius: "md" });
    expect(theme.components?.Badge?.defaultProps).toEqual({ radius: "sm" });
  });
});
