import { useCallback, useState, type FormEvent } from "react";
import { getOrgToken } from "@/lib/org-auth";
import type { Workspace } from "./types";

const API = `${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/api`;

export interface WorkspaceForm {
  name: string;
  description: string;
  capacity: string;
  hourly_rate_ngn: string;
  workspace_type: string;
  floor: string;
  amenities: string;
  image_url: string;
}

export const EMPTY_WORKSPACE_FORM: WorkspaceForm = {
  name: "",
  description: "",
  capacity: "1",
  hourly_rate_ngn: "2000",
  workspace_type: "hot_desk",
  floor: "1",
  amenities: "",
  image_url: "",
};

export function useOrgWorkspaces(refreshWorkspaces: () => Promise<void>) {
  const [showAddWs, setShowAddWs] = useState(false);
  const [wsForm, setWsForm] = useState<WorkspaceForm>({ ...EMPTY_WORKSPACE_FORM });
  const [wsLoading, setWsLoading] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsImageFile, setWsImageFile] = useState<File | null>(null);
  const [wsImagePreview, setWsImagePreview] = useState<string | null>(null);
  const [wsImageUploading, setWsImageUploading] = useState(false);
  const [showEditWs, setShowEditWs] = useState(false);
  const [editingWs, setEditingWs] = useState<Workspace | null>(null);
  const [editForm, setEditForm] = useState<WorkspaceForm>({ ...EMPTY_WORKSPACE_FORM });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const [editImageUploading, setEditImageUploading] = useState(false);

  const uploadImage = useCallback(async (file: File) => {
    const form = new FormData();
    form.append("image", file);
    const response = await fetch(`${API}/org/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getOrgToken()}` },
      body: form,
    });
    if (!response.ok) throw new Error("Image upload failed");
    const data = await response.json();
    return (data.url as string | undefined) ?? null;
  }, []);

  const handleAddWorkspace = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setWsLoading(true);
    setWsError(null);
    try {
      let imageUrl = wsForm.image_url;
      if (wsImageFile) {
        setWsImageUploading(true);
        imageUrl = (await uploadImage(wsImageFile)) ?? imageUrl;
      }
      const response = await fetch(`${API}/org/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getOrgToken()}` },
        body: JSON.stringify({
          ...wsForm,
          image_url: imageUrl,
          capacity: Number(wsForm.capacity),
          hourly_rate_ngn: Number(wsForm.hourly_rate_ngn),
          floor: Number(wsForm.floor),
          amenities: wsForm.amenities.split(",").map(item => item.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setShowAddWs(false);
      setWsForm({ ...EMPTY_WORKSPACE_FORM });
      setWsImageFile(null);
      setWsImagePreview(null);
      await refreshWorkspaces();
    } catch (error) {
      setWsError(error instanceof Error ? error.message : String(error));
    } finally {
      setWsLoading(false);
      setWsImageUploading(false);
    }
  }, [refreshWorkspaces, uploadImage, wsForm, wsImageFile]);

  const openEditModal = useCallback((workspace: Workspace) => {
    let amenities: string;
    try {
      amenities = (JSON.parse(workspace.amenities) as string[]).join(", ");
    } catch {
      amenities = workspace.amenities;
    }
    setEditingWs(workspace);
    setEditForm({
      name: workspace.name,
      description: workspace.description ?? "",
      capacity: String(workspace.capacity),
      hourly_rate_ngn: String(workspace.hourlyRateNgn),
      workspace_type: workspace.workspaceType,
      floor: "1",
      amenities,
      image_url: workspace.imageUrl ?? "",
    });
    setEditImageFile(null);
    setEditImagePreview(workspace.imageUrl ?? null);
    setEditError(null);
    setShowEditWs(true);
  }, []);

  const handleEditWorkspace = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!editingWs) return;
    setEditLoading(true);
    setEditError(null);
    try {
      let imageUrl = editForm.image_url;
      if (editImageFile) {
        setEditImageUploading(true);
        imageUrl = (await uploadImage(editImageFile)) ?? imageUrl;
      }
      const response = await fetch(`${API}/org/workspaces/${editingWs.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getOrgToken()}` },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description,
          capacity: Number(editForm.capacity),
          hourly_rate_ngn: Number(editForm.hourly_rate_ngn),
          amenities: editForm.amenities.split(",").map(item => item.trim()).filter(Boolean),
          image_url: imageUrl,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setShowEditWs(false);
      setEditingWs(null);
      await refreshWorkspaces();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setEditLoading(false);
      setEditImageUploading(false);
    }
  }, [editForm, editImageFile, editingWs, refreshWorkspaces, uploadImage]);

  const toggleAvailability = useCallback(async (workspace: Workspace) => {
    try {
      await fetch(`${API}/org/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getOrgToken()}` },
        body: JSON.stringify({ is_available: !workspace.isAvailable }),
      });
      await refreshWorkspaces();
    } catch {
      // Keep the current list when the update request fails.
    }
  }, [refreshWorkspaces]);

  return {
    showAddWs, setShowAddWs, wsForm, setWsForm, wsLoading, wsError,
    wsImageFile, setWsImageFile, wsImagePreview, setWsImagePreview, wsImageUploading,
    showEditWs, setShowEditWs, editingWs, setEditingWs, editForm, setEditForm,
    editLoading, editError, editImageFile, setEditImageFile,
    editImagePreview, setEditImagePreview, editImageUploading,
    handleAddWorkspace, openEditModal, handleEditWorkspace, toggleAvailability,
  };
}