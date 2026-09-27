import type { Workspace } from "./org-dashboard";

type Props = {
  workspaces: Workspace[];
  orgKycStatus?: string;
  setShowAddWs: (value: boolean) => void;
  openEditModal: (ws: Workspace) => void;
  toggleAvailability: (ws: Workspace) => void;
};

export default function OrgWorkspacesTab({ workspaces, orgKycStatus, setShowAddWs, openEditModal, toggleAvailability }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-white text-xl font-semibold">Your Workspaces</h2>
        <button
          onClick={() => setShowAddWs(true)}
          disabled={orgKycStatus === "rejected"}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-40"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Workspace
        </button>
      </div>

      {workspaces.length === 0 ? (
        <div className="text-center py-16 bg-[#111] border border-white/10 rounded-2xl">
          <p className="text-4xl mb-4">🏢</p>
          <p className="text-white font-medium mb-1">No workspaces yet</p>
          <p className="text-gray-500 text-sm mb-6">Add your first workspace to start accepting bookings.</p>
          <button onClick={() => setShowAddWs(true)} className="px-4 py-2 bg-purple-600 text-white text-sm rounded-xl">
            Add Your First Workspace
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {workspaces.map((ws) => (
            <div key={ws.id} className="bg-[#111] border border-white/10 rounded-2xl p-5 flex flex-col gap-3">
              {ws.imageUrl && <img src={ws.imageUrl} alt={ws.name} className="w-full h-32 object-cover rounded-xl" />}
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-white font-medium">{ws.name}</p>
                  <p className="text-gray-500 text-xs mt-0.5 capitalize">{ws.workspaceType.replace("_", " ")} · {ws.capacity} seat{ws.capacity > 1 ? "s" : ""}</p>
                </div>
                <button
                  onClick={() => toggleAvailability(ws)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${ws.isAvailable ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-500 border-gray-600/30"}`}
                >
                  {ws.isAvailable ? "Available" : "Offline"}
                </button>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">₦{ws.hourlyRateNgn.toLocaleString()}/hr</span>
                <span className="text-gray-600 text-xs">${ws.hourlyRateUsdc.toFixed(2)} USDC</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEditModal(ws)} className="flex-1 py-2 text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition-all">
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
