import { DocumentsManager } from './documents-manager';

export default function DocumentsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Documents</h1>
      <p className="mt-1 text-slate-600">
        Your assistant answers only from these files. Uploads are processed in the background.
      </p>
      <DocumentsManager />
    </div>
  );
}
