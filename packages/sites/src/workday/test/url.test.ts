import { describe, expect, it } from "vitest";
import { detectSite } from "../../registry.js";
import { isWorkdayUrl, workdayTenant } from "../registry.js";

describe("Workday hosts and tenants", () => {
  it("counts only candidate-facing Workday sites as Workday", () => {
    expect(detectSite("https://acme.wd5.myworkdayjobs.com/en-US/External/job/x")).toBe("workday");
    expect(detectSite("https://wd5.myworkdaysite.com/recruiting/acme/External")).toBe("workday");
    // Workday's marketing site and employee tenants aren't application sites.
    expect(detectSite("https://www.workday.com/en-us/products.html")).toBe("generic");
    expect(detectSite("https://wd5.myworkday.com/acme/d/home.htmld")).toBe("generic");
    expect(detectSite("not a url")).toBe("generic");
    expect(isWorkdayUrl("https://evilmyworkdayjobs.com/x")).toBe(false);
  });

  it("reads the tenant from the host or, on myworkdaysite.com, the path", () => {
    expect(workdayTenant("https://Acme.wd5.myworkdayjobs.com/en-US/External")).toBe("acme");
    expect(workdayTenant("https://wd5.myworkdaysite.com/recruiting/Acme/External/job/1")).toBe("acme");
    expect(workdayTenant("https://wd5.myworkdaysite.com/en-US/recruiting/acme/External")).toBe("acme");
    expect(workdayTenant("https://wd5.myworkdaysite.com/")).toBeUndefined();
    expect(workdayTenant("https://careers.acme.com/jobs/1")).toBeUndefined();
  });
});
