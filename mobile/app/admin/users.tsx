import React, { useEffect, useState } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Platform, Alert
} from 'react-native';
import { Text } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { GasTaColors, GasTaSpacing, radii } from '@/constants/Theme';
import { formatDate } from '@/lib/format';
import { Ionicons } from '@expo/vector-icons';
import LoadingState from '@/components/ui/LoadingState';

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: 'user' | 'developer' | 'admin';
  created_at: string;
  vehicle_count: number;
};

type Vehicle = {
  id: string;
  brand: string;
  model: string;
  year: number;
  nickname: string | null;
  fuel_efficiency_km_per_liter: number;
};

type VehicleEdits = { nickname: string; fuel_efficiency: string };

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.full_name ?? '');
  const [role, setRole] = useState<'user' | 'developer' | 'admin'>(user.role);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleEdits, setVehicleEdits] = useState<Record<string, VehicleEdits>>({});
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingVehicleId, setSavingVehicleId] = useState<string | null>(null);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchVehicles() {
      const { data, error } = await supabase.rpc('admin_get_user_vehicles', {
        target_user_id: user.user_id,
      });
      if (!error && data) {
        setVehicles(data);
        // Initialise edits map
        const edits: Record<string, VehicleEdits> = {};
        (data as Vehicle[]).forEach(v => {
          edits[v.id] = {
            nickname: v.nickname ?? '',
            fuel_efficiency: String(v.fuel_efficiency_km_per_liter),
          };
        });
        setVehicleEdits(edits);
      }
      setLoadingVehicles(false);
    }
    fetchVehicles();
  }, [user.user_id]);

  const handleSaveProfile = async () => {
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc('admin_update_profile', {
      target_user_id: user.user_id,
      new_full_name: name.trim(),
      new_role: role,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
    } else {
      onSaved();
    }
  };

  const handleSaveVehicle = async (vehicleId: string) => {
    const edits = vehicleEdits[vehicleId];
    const efficiency = parseFloat(edits.fuel_efficiency);
    if (!edits || isNaN(efficiency) || efficiency <= 0) {
      setError('Fuel efficiency must be a positive number.');
      return;
    }
    setSavingVehicleId(vehicleId);
    setError(null);
    const { error } = await supabase.rpc('admin_update_vehicle', {
      target_vehicle_id: vehicleId,
      new_nickname: edits.nickname.trim() || null,
      new_fuel_efficiency: efficiency,
    });
    setSavingVehicleId(null);
    if (error) {
      setError(error.message);
    } else {
      setVehicles(prev =>
        prev.map(v =>
          v.id === vehicleId
            ? { ...v, nickname: edits.nickname.trim() || null, fuel_efficiency_km_per_liter: efficiency }
            : v
        )
      );
      setEditingVehicleId(null);
    }
  };

  const handleDeleteVehicle = async (vehicleId: string, label: string) => {
    const doDelete = async () => {
      const { error } = await supabase.rpc('admin_delete_vehicle', {
        target_vehicle_id: vehicleId,
      });
      if (error) {
        setError(error.message);
      } else {
        setVehicles(prev => prev.filter(v => v.id !== vehicleId));
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete vehicle "${label}"?`)) doDelete();
    } else {
      Alert.alert('Delete Vehicle', `Delete "${label}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const ROLES: Array<'user' | 'developer' | 'admin'> = ['user', 'developer', 'admin'];

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit User</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={GasTaColors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Email (read-only) */}
            <Text style={styles.fieldLabel}>Email</Text>
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>{user.email}</Text>
            </View>

            {/* Full Name */}
            <Text style={styles.fieldLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter name"
              placeholderTextColor={GasTaColors.textSoft}
            />

            {/* Role */}
            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleRow}>
              {ROLES.map(r => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setRole(r)}
                  style={[
                    styles.roleChip,
                    role === r && styles.roleChipActive,
                    r === 'admin' && role === r && styles.roleChipAdmin,
                    r === 'developer' && role === r && styles.roleChipDev,
                  ]}
                >
                  <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Save profile button */}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity onPress={handleSaveProfile} style={[styles.saveBtn, { marginTop: 16, marginBottom: 4 }]} disabled={saving}>
              {saving ? (
                <ActivityIndicator color={GasTaColors.white} size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Save Profile &amp; Role</Text>
              )}
            </TouchableOpacity>

            {/* Vehicles */}
            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>
              Vehicles ({vehicles.length})
            </Text>
            {loadingVehicles ? (
              <ActivityIndicator color={GasTaColors.forest} style={{ marginVertical: 8 }} />
            ) : vehicles.length === 0 ? (
              <Text style={styles.emptyVehicles}>No vehicles registered.</Text>
            ) : (
              vehicles.map(v => {
                const label = `${v.brand} ${v.model} (${v.year})`;
                const isEditing = editingVehicleId === v.id;
                const edits = vehicleEdits[v.id] ?? { nickname: '', fuel_efficiency: '' };
                return (
                  <View key={v.id} style={styles.vehicleCard}>
                    <View style={styles.vehicleTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.vehicleName}>{label}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setEditingVehicleId(isEditing ? null : v.id)}
                        style={styles.vehicleEditToggle}
                      >
                        <Ionicons name={isEditing ? 'chevron-up' : 'pencil-outline'} size={15} color={GasTaColors.forest} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteVehicle(v.id, label)}
                        style={styles.vehicleDeleteBtn}
                      >
                        <Ionicons name="trash-outline" size={15} color={GasTaColors.error} />
                      </TouchableOpacity>
                    </View>

                    {isEditing ? (
                      <View style={{ marginTop: 10, gap: 8 }}>
                        <View>
                          <Text style={styles.vehicleFieldLabel}>Nickname</Text>
                          <TextInput
                            style={styles.input}
                            value={edits.nickname}
                            onChangeText={val => setVehicleEdits(prev => ({ ...prev, [v.id]: { ...prev[v.id], nickname: val } }))}
                            placeholder="e.g. My Car"
                            placeholderTextColor={GasTaColors.textSoft}
                          />
                        </View>
                        <View>
                          <Text style={styles.vehicleFieldLabel}>Fuel Efficiency (km/L)</Text>
                          <TextInput
                            style={styles.input}
                            value={edits.fuel_efficiency}
                            onChangeText={val => setVehicleEdits(prev => ({ ...prev, [v.id]: { ...prev[v.id], fuel_efficiency: val } }))}
                            keyboardType="decimal-pad"
                            placeholder="e.g. 12.5"
                            placeholderTextColor={GasTaColors.textSoft}
                          />
                        </View>
                        <TouchableOpacity
                          onPress={() => handleSaveVehicle(v.id)}
                          style={[styles.saveBtn, { paddingVertical: 9 }]}
                          disabled={savingVehicleId === v.id}
                        >
                          {savingVehicleId === v.id ? (
                            <ActivityIndicator color={GasTaColors.white} size="small" />
                          ) : (
                            <Text style={styles.saveBtnText}>Save Vehicle</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={styles.vehicleSub}>
                        {v.nickname ? `"${v.nickname}" · ` : ''}{v.fuel_efficiency_km_per_liter} km/L
                      </Text>
                    )}
                  </View>
                );
              })
            )}

            {/* Bottom cancel */}
            <TouchableOpacity onPress={onClose} style={[styles.cancelBtn, { marginTop: 16 }]}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────

function DeleteConfirmModal({
  user,
  onClose,
  onDeleted,
}: {
  user: UserRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setDeleting(true);
    setError(null);
    const { error } = await supabase.rpc('admin_delete_user', {
      target_user_id: user.user_id,
    });
    setDeleting(false);
    if (error) {
      setError(error.message);
    } else {
      onDeleted();
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { gap: 16 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Delete User</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={GasTaColors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Ionicons
            name="warning-outline"
            size={48}
            color={GasTaColors.error}
            style={{ alignSelf: 'center' }}
          />

          <Text style={styles.deleteWarningText}>
            You are about to permanently delete:
          </Text>
          <View style={styles.readonlyField}>
            <Text style={[styles.readonlyText, { fontWeight: '700' }]}>
              {user.full_name || 'No Name'}
            </Text>
            <Text style={styles.readonlyText}>{user.email}</Text>
          </View>
          <Text style={styles.deleteSubText}>
            This will delete all their vehicles, trips, budgets and data. This action cannot be undone.
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.modalActions}>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleConfirm}
              style={[styles.saveBtn, { backgroundColor: GasTaColors.error }]}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator color={GasTaColors.white} size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Delete Permanently</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function UserManagementScreen() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserRow | null>(null);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_admin_users_and_vehicles');
    if (error) setErrorMsg(error.message);
    if (data) setUsers(data as UserRow[]);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  if (loading && users.length === 0) return <LoadingState message="Loading Users..." />;

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.headerTitle}>User Management</Text>

        {errorMsg ? (
          <Text style={{ color: GasTaColors.error, marginBottom: 16 }}>Error: {errorMsg}</Text>
        ) : (
          <Text style={styles.summaryText}>Total Users: {users.length}</Text>
        )}

        {users.map(u => (
          <View key={u.user_id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="person-circle-outline" size={24} color={GasTaColors.forest} />
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{u.full_name || 'No Name'}</Text>
                <Text style={styles.userEmail}>{u.email}</Text>
              </View>
              <View
                style={[
                  styles.roleBadge,
                  u.role === 'admin'
                    ? styles.roleAdmin
                    : u.role === 'developer'
                    ? styles.roleDev
                    : styles.roleUser,
                ]}
              >
                <Text style={styles.roleText}>{u.role}</Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Joined</Text>
                <Text style={styles.statValue}>{formatDate(u.created_at)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Vehicles</Text>
                <Text style={styles.statValue}>{u.vehicle_count}</Text>
              </View>
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  onPress={() => setEditingUser(u)}
                  style={styles.actionBtn}
                  accessibilityLabel="Edit user"
                >
                  <Ionicons name="pencil-outline" size={18} color={GasTaColors.forest} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDeletingUser(u)}
                  style={[styles.actionBtn, styles.deleteBtn]}
                  accessibilityLabel="Delete user"
                >
                  <Ionicons name="trash-outline" size={18} color={GasTaColors.error} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null);
            loadData();
          }}
        />
      )}

      {deletingUser && (
        <DeleteConfirmModal
          user={deletingUser}
          onClose={() => setDeletingUser(null)}
          onDeleted={() => {
            setDeletingUser(null);
            loadData();
          }}
        />
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GasTaColors.creamLight },
  content: { padding: GasTaSpacing.lg },
  headerTitle: { fontSize: 24, fontWeight: '800', color: GasTaColors.forestDark, marginBottom: 8 },
  summaryText: { fontSize: 14, color: GasTaColors.textSoft, marginBottom: GasTaSpacing.lg },

  card: {
    backgroundColor: GasTaColors.white,
    borderRadius: radii.md,
    padding: GasTaSpacing.md,
    marginBottom: GasTaSpacing.md,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  userName: { fontSize: 15, fontWeight: '700', color: GasTaColors.textPrimary },
  userEmail: { fontSize: 13, color: GasTaColors.textSoft },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  roleAdmin: { backgroundColor: '#FEE2E2' },
  roleDev: { backgroundColor: '#FEF3C7' },
  roleUser: { backgroundColor: GasTaColors.cream },
  roleText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', color: GasTaColors.textPrimary },
  statsRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: GasTaColors.forestGlow, paddingTop: 12 },
  stat: { flex: 1 },
  statLabel: { fontSize: 11, color: GasTaColors.textSoft, textTransform: 'uppercase', marginBottom: 2 },
  statValue: { fontSize: 13, fontWeight: '600', color: GasTaColors.forestDark },
  actionButtons: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: { padding: 8, backgroundColor: GasTaColors.cream, borderRadius: radii.md },
  deleteBtn: { backgroundColor: '#FEE2E2' },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: GasTaSpacing.lg,
  },
  modalCard: {
    backgroundColor: GasTaColors.white,
    borderRadius: radii.lg,
    padding: GasTaSpacing.lg,
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: GasTaSpacing.md,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: GasTaColors.forestDark },

  fieldLabel: { fontSize: 12, fontWeight: '600', color: GasTaColors.textSoft, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    borderRadius: radii.md,
    padding: 10,
    fontSize: 14,
    color: GasTaColors.textPrimary,
    backgroundColor: GasTaColors.creamLight,
  },
  readonlyField: {
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    borderRadius: radii.md,
    padding: 10,
    backgroundColor: GasTaColors.cream,
  },
  readonlyText: { fontSize: 14, color: GasTaColors.textSoft },

  // Role chips
  roleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.creamLight,
  },
  roleChipActive: { borderColor: GasTaColors.forest, backgroundColor: GasTaColors.forest },
  roleChipAdmin: { borderColor: '#DC2626', backgroundColor: '#DC2626' },
  roleChipDev: { borderColor: '#D97706', backgroundColor: '#D97706' },
  roleChipText: { fontSize: 13, fontWeight: '600', color: GasTaColors.textSoft },
  roleChipTextActive: { color: GasTaColors.white },

  // Vehicles
  vehicleCard: {
    backgroundColor: GasTaColors.creamLight,
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: GasTaColors.forestGlow,
  },
  vehicleTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  vehicleName: { fontSize: 14, fontWeight: '700', color: GasTaColors.textPrimary },
  vehicleSub: { fontSize: 13, color: GasTaColors.textSoft, marginTop: 2 },
  vehicleEditToggle: {
    padding: 6,
    backgroundColor: GasTaColors.cream,
    borderRadius: radii.sm,
  },
  vehicleDeleteBtn: {
    padding: 6,
    backgroundColor: '#FEE2E2',
    borderRadius: radii.sm,
  },
  emptyVehicles: { fontSize: 13, color: GasTaColors.textSoft, fontStyle: 'italic', marginBottom: 8 },
  vehicleFieldLabel: { fontSize: 11, fontWeight: '600', color: GasTaColors.textSoft, textTransform: 'uppercase', marginBottom: 4 },

  // Errors
  errorText: { color: GasTaColors.error, fontSize: 13, marginTop: 8 },

  // Modal actions
  modalActions: { flexDirection: 'row', gap: 10, marginTop: GasTaSpacing.lg },
  cancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: GasTaColors.forestBorder,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: GasTaColors.textPrimary },
  saveBtn: {
    flex: 1,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: GasTaColors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: GasTaColors.white },

  // Delete modal
  deleteWarningText: { fontSize: 14, color: GasTaColors.textPrimary, textAlign: 'center' },
  deleteSubText: { fontSize: 13, color: GasTaColors.textSoft, textAlign: 'center', lineHeight: 20 },
});
