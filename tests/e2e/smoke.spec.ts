import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixturePath = process.env.SMOKE_FIXTURE;
if (!fixturePath) throw new Error("请通过 npm run test:e2e 启动，确保使用隔离数据库");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { creds: { admin: string }; b: { projA: string; reqA: string; relB: string } };

test("登录、需求创建和主要页面导航", async ({ page }) => {
  await page.goto("/requirements");
  await expect(page).toHaveURL(/\/login/);
  await page.getByPlaceholder("请输入邮箱或手机号").fill("sec-admin@verify.test");
  await page.getByPlaceholder("请输入登录密码").fill("错误密码");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("账号或密码错误")).toBeVisible();
  await page.getByPlaceholder("请输入登录密码").fill(fixture.creds.admin);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/requirements/);
  await page.goto(`/requirements/new?project=${fixture.b.projA}`);
  const title = `自动化需求 ${Date.now()}`;
  await page.getByRole("textbox", { name: "需求标题（必填）" }).fill(title);
  await page.getByRole("button", { name: "创建需求", exact: true }).click();
  await expect(page).toHaveURL(/\/requirements\/(?!new(?:[/?#]|$))[a-z0-9]+/);
  await expect(page.getByRole("textbox", { name: "需求标题（必填）" })).toHaveValue(title);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "需求标题（必填）" })).toHaveValue(title);
  for (const path of ["/projects", `/projects/${fixture.b.projA}/board`, "/releases", "/bugs", "/leadership", "/members"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("body")).not.toContainText("Application error");
  }
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入邮箱或手机号").fill("sec-admin@verify.test");
  await page.getByPlaceholder("请输入登录密码").fill(fixture.creds.admin);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("看板使用移动菜单变更状态并保持", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page);
  await page.goto(`/projects/${fixture.b.projA}/board`);
  const title = "甲企业需求SEC";
  await expect(page.getByRole("region", { name: /^开发中，/ }).getByText(title)).toBeVisible();
  const move = page.getByRole("button", { name: `移动「${title}」到…` });
  await move.scrollIntoViewIfNeeded();
  await move.click();
  await expect(page.getByRole("menu", { name: "移动到…" })).toBeVisible();
  const saved = page.waitForResponse((response) => response.url().includes(`/api/requirements/${fixture.b.reqA}/status`) && response.request().method() === "PATCH");
  await page.getByRole("menuitemradio", { name: "待测试", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("region", { name: /^待测试，/ }).getByText(title)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: /^待测试，/ }).getByText(title)).toBeVisible();
});

test("发版冻结后刷新保持状态", async ({ page }) => {
  await login(page);
  await page.goto(`/releases/${fixture.b.relB}`);
  await page.getByRole("button", { name: "v1.0.0 更多发版操作" }).click();
  await page.getByRole("menuitem", { name: "冻结", exact: true }).click();
  await page.getByRole("button", { name: "确认冻结" }).click();
  await expect(page.getByRole("button", { name: "v1.0.0 更多发版操作" })).toBeVisible();
  await expect(page.getByText("已冻结").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("已冻结").first()).toBeVisible();
});

test("项目成员添加和移除", async ({ page }) => {
  await login(page);
  await page.goto(`/projects/${fixture.b.projA}/members`);
  const row = page.getByRole("row").filter({ hasText: "sec-target" });
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "添加成员", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加成员" });
  await dialog.getByRole("textbox", { name: "按姓名或账号搜索人员" }).fill("sec-target");
  await dialog.getByRole("checkbox", { name: /sec-target/ }).check();
  await dialog.getByRole("button", { name: "加入项目（1）" }).click();
  await expect(row).toBeVisible();
  await page.reload();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "移除成员" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "移出项目" }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
});

test("两人同时编辑需求：后保存的人看到冲突提示，不覆盖对方", async ({ browser }) => {
  const open = async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    await page.goto(`/requirements/${fixture.b.reqA}`);
    return page;
  };
  const a = await open();
  const b = await open();
  const titleA = a.getByRole("textbox", { name: "需求标题（必填）" });
  const first = `A 先改的标题 ${Date.now()}`;
  const saved = (page: typeof a) => page.waitForResponse((r) => r.url().includes(`/api/requirements/${fixture.b.reqA}`) && r.request().method() === "PATCH");
  await titleA.fill(first);
  const savedA = saved(a);
  await titleA.blur();
  expect((await savedA).status()).toBe(200);
  const titleB = b.getByRole("textbox", { name: "需求标题（必填）" });
  await titleB.fill("B 后改的标题");
  const savedB = saved(b);
  await titleB.blur();
  expect((await savedB).status()).toBe(409);
  await expect(b.getByText(/内容已被其他人修改/)).toBeVisible();
  // B 的修改没有覆盖 A；A 用自己保存后拿到的新版本号继续保存不受影响
  await a.reload();
  await expect(titleA).toHaveValue(first);
  const second = `A 第二次改 ${Date.now()}`;
  await titleA.fill(second);
  const savedA2 = saved(a);
  await titleA.blur();
  expect((await savedA2).status()).toBe(200);
  await a.reload();
  await expect(titleA).toHaveValue(second);
});
