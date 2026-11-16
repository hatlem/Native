import Page from "@/app/[locale]/(marketing)/terms/page";
import { localeParams, staticPage } from "../../static-page";

// Prerendered at build for every locale (see app/static/[locale]/layout.tsx).
export { generateMetadata } from "@/app/[locale]/(marketing)/terms/page";
export const generateStaticParams = localeParams;
export const dynamicParams = false;

export default staticPage(Page);
