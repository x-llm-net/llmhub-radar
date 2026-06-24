const DEMO_PAGE_DESCRIPTION_EN = "Get informed about our services.";
const DEMO_PAGE_DESCRIPTION_ZH = "及时了解我们的服务状态。";

export function getStatusPageDescription(
  description: string | null | undefined,
  locale: string,
) {
  if (!description) return description;
  if (locale === "zh" && description === DEMO_PAGE_DESCRIPTION_EN) {
    return DEMO_PAGE_DESCRIPTION_ZH;
  }
  return description;
}
