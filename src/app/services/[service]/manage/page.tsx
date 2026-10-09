import { ManagementPageForService, type ManagementSearch } from "@/app/services/_components/management-page";
export default async function ManagementPage({ params, searchParams }: { params: Promise<{ service: string }>; searchParams: ManagementSearch }) {
  return <ManagementPageForService service={(await params).service} searchParams={searchParams} />;
}
