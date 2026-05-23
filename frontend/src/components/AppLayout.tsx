import {
  AppShell,
  Group,
  Text,
  NavLink,
  Burger,
  ActionIcon,
  useMantineColorScheme,
  Tooltip,
  Select,
  Box,
  Divider,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { Sun, Moon, Globe, Database, Briefcase, Activity } from "lucide-react";

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isDark = colorScheme === "dark";

  const navItems = [
    { label: t("nav.sites"), icon: <Database size={18} />, href: "/sites" },
    { label: t("nav.jobs"), icon: <Briefcase size={18} />, href: "/jobs" },
  ];

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
            />
            <Group gap={8}>
              <Activity size={22} color="var(--mantine-color-brand-5)" />
              <Text fw={700} size="md" c="brand">
                {t("nav.appName")}
              </Text>
            </Group>
          </Group>

          <Group gap="xs">
            {/* Language toggle */}
            <Tooltip label={t("language.toggle")}>
              <Select
                size="xs"
                w={100}
                value={i18n.language.startsWith("ja") ? "ja" : "en"}
                onChange={(v) => i18n.changeLanguage(v ?? "en")}
                data={[
                  { value: "en", label: t("language.en") },
                  { value: "ja", label: t("language.ja") },
                ]}
                leftSection={<Globe size={14} />}
                styles={{ input: { cursor: "pointer" } }}
              />
            </Tooltip>

            {/* Theme toggle */}
            <Tooltip label={t("theme.toggle")}>
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => toggleColorScheme()}
                aria-label={t("theme.toggle")}
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Box mt={4}>
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              label={item.label}
              leftSection={item.icon}
              active={pathname.startsWith(item.href)}
              onClick={() => {
                navigate(item.href);
                if (opened) toggle();
              }}
              style={{ borderRadius: "var(--mantine-radius-md)" }}
              mb={4}
            />
          ))}
        </Box>
        <Divider mt="auto" mb="xs" />
        <Text size="xs" c="dimmed" ta="center">
          v2.0.0
        </Text>
      </AppShell.Navbar>

      <AppShell.Main>
        <Notifications position="top-right" />
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
