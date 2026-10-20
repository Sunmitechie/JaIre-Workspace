import type { ChangeEvent } from "react";
import { useOrgWorkspaces } from "./useOrgWorkspaces";

type Actions = ReturnType<typeof useOrgWorkspaces>;

function ImageUploadField({
  label,
  file,
  preview,
  onFile,
  onPreview,
}: {
  label: string;
  file: File | null;
  preview: string | null;
  onFile: (file: File | null) => void;
  onPreview: (preview: string | null) => void;
}) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    onFile(selected);
    if (selected) {
      const reader = new FileReader();
      reader.onload = () => onPreview(reader.result as string);
      reader.readAsDataURL(selected);
    }
  };

  return (
    <div>
      <label className="text-gray-400 text-sm block mb-1">{label}</label>
      {preview && (
        <div className="relative mb-2">
          <img src={preview} alt="preview" className="w-full h-28 object-cover rounded-xl" />
          <button type="button" onClick={() => { onFile(null); onPreview(null); }} className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/70 hover:bg-black rounded-full flex items-center justify-center text-white text-xs">✕</button>
        </div>
      )}
      <label className="block w-full cursor-pointer">
        <input type="file" accept="image/*" className="hidden" onChange={handleChange} />
        <div className="w-full bg-[#1a1a1a] border border-dashed border-white/20 hover:border-purple-500/50 rounded-xl px-4 py-3 text-gray-600 text-sm text-center transition-all">
          {file ? `📷 ${file.name}` : "Click to upload image"}
        </div>
      </label>
    </div>
  );
}

export default function OrgWorkspaceModals({ actions }: { actions: Actions }) {
  const {
    showAddWs, setShowAddWs, wsForm, setWsForm, wsLoading, wsError,
    wsImageFile, setWsImageFile, wsImagePreview, setWsImagePreview, wsImageUploading,
    showEditWs, setShowEditWs, editingWs, editForm, setEditForm, editLoading,
    editError, editImageFile, setEditImageFile, editImagePreview, setEditImagePreview,
    editImageUploading, handleAddWorkspace, handleEditWorkspace,
  } = actions;

  return (
    <>
      {showAddWs && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-semibold text-lg">Add New Workspace</h3>
              <button onClick={() => { setShowAddWs(false); setWsImageFile(null); setWsImagePreview(null); }} className="text-gray-500 hover:text-gray-300">×</button>
            </div>
            {wsError && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{wsError}</div>}
            <form onSubmit={handleAddWorkspace} className="space-y-4">
              <label className="block text-gray-400 text-sm">Name *<input required value={wsForm.name} onChange={event => setWsForm(form => ({ ...form, name: event.target.value }))} placeholder="Ground Floor Hot Desk A" className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm" /></label>
              <label className="block text-gray-400 text-sm">Description<textarea rows={2} value={wsForm.description} onChange={event => setWsForm(form => ({ ...form, description: event.target.value }))} placeholder="Quiet corner desk with natural light..." className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm resize-none" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-gray-400 text-sm">Type<select value={wsForm.workspace_type} onChange={event => setWsForm(form => ({ ...form, workspace_type: event.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm"><option value="hot_desk">Hot Desk</option><option value="private_suite">Private Suite</option><option value="meeting_room">Meeting Room</option><option value="lounge">Lounge</option></select></label>
                <label className="text-gray-400 text-sm">Capacity<input type="number" min="1" value={wsForm.capacity} onChange={event => setWsForm(form => ({ ...form, capacity: event.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm" /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-gray-400 text-sm">Hourly Rate (₦) *<input required type="number" min="100" value={wsForm.hourly_rate_ngn} onChange={event => setWsForm(form => ({ ...form, hourly_rate_ngn: event.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm" /></label>
                <label className="text-gray-400 text-sm">Floor<input type="number" min="1" value={wsForm.floor} onChange={event => setWsForm(form => ({ ...form, floor: event.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm" /></label>
              </div>
              <label className="block text-gray-400 text-sm">Amenities<input value={wsForm.amenities} onChange={event => setWsForm(form => ({ ...form, amenities: event.target.value }))} placeholder="WiFi, Standing Desk, Coffee, AC" className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm" /></label>
              <ImageUploadField label="Workspace Photo" file={wsImageFile} preview={wsImagePreview} onFile={setWsImageFile} onPreview={setWsImagePreview} />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAddWs(false); setWsImageFile(null); setWsImagePreview(null); }} className="flex-1 py-3 bg-white/5 text-white text-sm rounded-xl">Cancel</button>
                <button type="submit" disabled={wsLoading || wsImageUploading} className="flex-1 py-3 bg-purple-600 text-white text-sm rounded-xl disabled:opacity-50">{wsImageUploading ? "Uploading..." : wsLoading ? "Adding..." : "Add Workspace"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showEditWs && editingWs && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-semibold text-lg">Edit Workspace</h3>
              <button onClick={() => { setShowEditWs(false); setEditImageFile(null); setEditImagePreview(null); }} className="text-gray-500 hover:text-gray-300">×</button>
            </div>
            {editError && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{editError}</div>}
            <form onSubmit={handleEditWorkspace} className="space-y-4">
              <label className="block text-gray-400 text-sm">Name *<input required value={editForm.name} onChange={event => setEditForm(form => ({ ...form, name: event.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm" /></label>
              <label className="block text-gray-400 text-sm">Description<textarea rows={2} value={editForm.description} onChange={event => setEditForm(form => ({ ...form, description: event.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm resize-none" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-gray-400 text-sm">Capacity<input type="number" min="1" value={editForm.capacity} onChange={event => setEditForm(form => ({ ...form, capacity: event.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm" /></label>
                <label className="text-gray-400 text-sm">Hourly Rate (₦) *<input required type="number" min="100" value={editForm.hourly_rate_ngn} onChange={event => setEditForm(form => ({ ...form, hourly_rate_ngn: event.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm" /></label>
              </div>
              <label className="block text-gray-400 text-sm">Amenities<input value={editForm.amenities} onChange={event => setEditForm(form => ({ ...form, amenities: event.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white text-sm" /></label>
              <ImageUploadField label="Workspace Photo" file={editImageFile} preview={editImagePreview} onFile={setEditImageFile} onPreview={setEditImagePreview} />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowEditWs(false); setEditImageFile(null); setEditImagePreview(null); }} className="flex-1 py-3 bg-white/5 text-white text-sm rounded-xl">Cancel</button>
                <button type="submit" disabled={editLoading || editImageUploading} className="flex-1 py-3 bg-purple-600 text-white text-sm rounded-xl disabled:opacity-50">{editImageUploading ? "Uploading..." : editLoading ? "Saving..." : "Save Changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
