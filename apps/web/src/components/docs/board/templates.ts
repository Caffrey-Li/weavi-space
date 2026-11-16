import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

/** 新建画布的模板：用 Excalidraw 的骨架格式描述，打开时再转成真正的图形 */
const GREEN = "#d3f9d8";
const YELLOW = "#fff3bf";
const BLUE = "#d0ebff";
const ORANGE = "#ffe8cc";
const GRAY = "#f1f3f5";

const box = (id: string, text: string, x: number, y: number, extra: Partial<ExcalidrawElementSkeleton> = {}): ExcalidrawElementSkeleton =>
  ({ type: "rectangle", id, x, y, width: 160, height: 64, roundness: { type: 3 }, backgroundColor: "#ffffff", fillStyle: "solid", strokeWidth: 1, roughness: 0, label: { text, fontSize: 18, fontFamily: 2 }, ...extra }) as ExcalidrawElementSkeleton;
/** 连线：从 (x1, y1) 指到 (x2, y2)，两端绑定到图形上，拖动图形时连线跟着走 */
const arrow = (from: string, to: string, x1: number, y1: number, x2: number, y2: number, label?: string): ExcalidrawElementSkeleton =>
  ({ type: "arrow", x: x1, y: y1, width: x2 - x1, height: y2 - y1, roughness: 0, strokeWidth: 1, start: { id: from }, end: { id: to }, ...(label ? { label: { text: label, fontSize: 14, fontFamily: 2 } } : {}) }) as ExcalidrawElementSkeleton;
const title = (text: string, x: number, y: number, size = 28): ExcalidrawElementSkeleton => ({ type: "text", x, y, text, fontSize: size, fontFamily: 2 }) as ExcalidrawElementSkeleton;

function flow(): ExcalidrawElementSkeleton[] {
  return [
    title("流程图", 0, -90),
    { ...box("start", "开始", 0, 0, { type: "ellipse", backgroundColor: GREEN }) },
    box("s1", "提交申请", 240, 0),
    { ...box("check", "是否通过？", 480, -18, { type: "diamond", width: 180, height: 100, backgroundColor: YELLOW }) },
    box("s2", "执行", 760, 0),
    { ...box("end", "结束", 1000, 0, { type: "ellipse", backgroundColor: GREEN }) },
    box("back", "退回修改", 490, 200, { backgroundColor: "#ffe3e3" }),
    arrow("start", "s1", 164, 32, 236, 32),
    arrow("s1", "check", 404, 32, 476, 32),
    arrow("check", "s2", 664, 32, 756, 32, "是"),
    arrow("s2", "end", 924, 32, 996, 32),
    arrow("check", "back", 570, 86, 570, 196, "否"),
    arrow("back", "s1", 486, 232, 320, 68),
  ];
}

function arch(): ExcalidrawElementSkeleton[] {
  const layer = (id: string, text: string, y: number, color: string): ExcalidrawElementSkeleton =>
    ({ type: "rectangle", id, x: 0, y, width: 840, height: 120, backgroundColor: color, fillStyle: "solid", roughness: 0, strokeWidth: 1, roundness: { type: 3 }, strokeStyle: "dashed" }) as ExcalidrawElementSkeleton;
  const label = (text: string, y: number) => ({ type: "text", x: 16, y: y + 10, text, fontSize: 16, fontFamily: 2 }) as ExcalidrawElementSkeleton;
  const node = (id: string, text: string, x: number, y: number) => box(id, text, x, y, { width: 180, height: 56 });
  return [
    title("系统架构图", 0, -80),
    layer("l1", "接入层", 0, BLUE), label("接入层", 0), node("web", "Web 前端", 140, 40), node("app", "移动端 App", 360, 40), node("open", "开放接口 / MCP", 580, 40),
    layer("l2", "服务层", 170, ORANGE), label("服务层", 170), node("gw", "API 网关", 140, 210), node("svc1", "业务服务", 360, 210), node("svc2", "消息 / 任务", 580, 210),
    layer("l3", "数据层", 340, GRAY), label("数据层", 340), node("db", "PostgreSQL", 140, 380), node("cache", "缓存", 360, 380), node("oss", "对象存储", 580, 380),
    arrow("web", "gw", 230, 100, 230, 206), arrow("svc1", "db", 450, 270, 450, 376), arrow("svc2", "oss", 670, 270, 670, 376),
  ];
}

function swimlane(): ExcalidrawElementSkeleton[] {
  const lanes = ["产品", "开发", "测试"];
  const els: ExcalidrawElementSkeleton[] = [title("泳道图", 0, -80)];
  lanes.forEach((name, i) => {
    els.push({ type: "rectangle", x: 0, y: i * 150, width: 1000, height: 150, backgroundColor: i % 2 ? "#ffffff" : GRAY, fillStyle: "solid", roughness: 0, strokeWidth: 1 } as ExcalidrawElementSkeleton);
    els.push({ type: "text", x: 16, y: i * 150 + 64, text: name, fontSize: 18, fontFamily: 2 } as ExcalidrawElementSkeleton);
  });
  els.push(box("p1", "写需求", 140, 43), box("p2", "需求评审", 380, 43), box("d1", "开发", 380, 193), box("d2", "提测", 620, 193), box("t1", "测试", 620, 343), box("t2", "上线", 840, 343, { backgroundColor: GREEN, width: 140 }));
  els.push(arrow("p1", "p2", 304, 75, 376, 75), arrow("p2", "d1", 460, 111, 460, 189), arrow("d1", "d2", 544, 225, 616, 225), arrow("d2", "t1", 700, 261, 700, 339), arrow("t1", "t2", 784, 375, 836, 375));
  return els;
}

export function boardTemplate(key: string): ExcalidrawElementSkeleton[] {
  if (key === "flow") return flow();
  if (key === "arch") return arch();
  if (key === "swimlane") return swimlane();
  return [];
}
