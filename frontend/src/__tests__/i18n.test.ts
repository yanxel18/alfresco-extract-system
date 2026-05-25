import i18n from "@/i18n";

describe("i18n", () => {
  it("initializes english and japanese resources", async () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.options.fallbackLng).toEqual(["en"]);
    expect(i18n.options.supportedLngs).toEqual(expect.arrayContaining(["en", "ja"]));

    await i18n.changeLanguage("en");
    expect(i18n.t("nav.sites")).toBe("Sites");

    await i18n.changeLanguage("ja");
    expect(i18n.t("nav.sites")).toBe("サイト");

    await i18n.changeLanguage("en");
  });

  it("stores the configured detection settings", () => {
    expect(i18n.options.interpolation).toMatchObject({ escapeValue: false });
    expect(i18n.options.detection).toMatchObject({
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "aes-language",
    });
  });
});
