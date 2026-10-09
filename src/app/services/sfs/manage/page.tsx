import { ManagementPageForService, type ManagementSearch } from "@/app/services/_components/management-page";
export default function ManagementPage({ searchParams }: { searchParams: ManagementSearch }) {
  return <ManagementPageForService service="sfs" searchParams={searchParams} />;
}
