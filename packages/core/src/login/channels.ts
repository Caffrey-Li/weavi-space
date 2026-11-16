import { createHmac, randomUUID } from "crypto";
import nodemailer from "nodemailer";
import { complete, providerConfig } from "./providers";

/** 发送通道：系统级的 SMTP 和阿里云短信。没配置时返回 false，调用方改为让管理员手动发链接 */

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const p = await providerConfig("", "email");
  if (!p || !complete("email", p.config)) return false;
  const c = p.config;
  const port = Number(c.port) || 465;
  const transport = nodemailer.createTransport({
    host: String(c.host),
    port,
    secure: c.secure === undefined ? port === 465 : Boolean(c.secure),
    auth: { user: String(c.user), pass: String(c.pass) },
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transport.sendMail({ from: String(c.from), to, subject, text });
  return true;
}

/** 阿里云短信 RPC 签名（HMAC-SHA1，SignatureVersion 1.0） */
export function aliyunSignedUrl(params: Record<string, string>, secret: string) {
  const enc = (s: string) => encodeURIComponent(s).replace(/!/g, "%21").replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
  const query = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join("&");
  const toSign = `GET&${enc("/")}&${enc(query)}`;
  const sig = createHmac("sha1", `${secret}&`).update(toSign).digest("base64");
  return `https://dysmsapi.aliyuncs.com/?Signature=${enc(sig)}&${query}`;
}

export async function sendSmsCode(phone: string, code: string): Promise<boolean> {
  const p = await providerConfig("", "sms");
  if (!p || !complete("sms", p.config)) return false;
  const c = p.config;
  const url = aliyunSignedUrl(
    {
      AccessKeyId: String(c.accessKeyId),
      Action: "SendSms",
      Format: "JSON",
      PhoneNumbers: phone.replace(/^\+86/, ""),
      RegionId: "cn-hangzhou",
      SignName: String(c.signName),
      SignatureMethod: "HMAC-SHA1",
      SignatureNonce: randomUUID(),
      SignatureVersion: "1.0",
      TemplateCode: String(c.templateCode),
      TemplateParam: JSON.stringify({ code }),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      Version: "2017-05-25",
    },
    String(c.accessKeySecret),
  );
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { Code?: string; Message?: string };
  if (data.Code !== "OK") throw new Error(`短信发送失败：${data.Message || data.Code || res.status}`);
  return true;
}
