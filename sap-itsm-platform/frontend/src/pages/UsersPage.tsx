import React, { useState } from 'react';
import { Plus, Search, Pencil, X, Check } from 'lucide-react';
import { useUsers, useCreateUser } from '../hooks/useApi';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../api/services';
import { DataTable, Column } from '../components/ui/DataTable';
import { PageHeader, Button, Input, Select } from '../components/ui/Forms';
import { StatusBadge } from '../components/ui/Badges';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../store/auth.store';
import { usersApi } from '../api/services';
import { useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '../api/client';
import { formatDistanceToNow, format } from 'date-fns';
import toast from 'react-hot-toast';

const ALL_ROLES = ['SUPER_ADMIN','COMPANY_ADMIN','USER'];
const CREATE_ROLES = ['COMPANY_ADMIN','USER']; // SUPER_ADMIN not created via this UI
const ALL_STATUSES = ['ACTIVE','INACTIVE','PENDING','LOCKED'];

export default function UsersPage() {
  const { user: currentUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRole] = useState('');
  const [showModal, setModal] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isCompanyAdmin = currentUser?.role === 'COMPANY_ADMIN';
  const canCreate = isSuperAdmin || isCompanyAdmin;

  // Role options based on who is logged in
  const roleOptions = isSuperAdmin
    ? CREATE_ROLES  // Super admin creates COMPANY_ADMIN, USER (AGENT/PM via Agents page)
    : ['USER'];     // Company admin can only create USER role
  // Note: AGENT and PROJECT_MANAGER are created via the Agents page

  const { data, isLoading } = useUsers({ page, limit: 20, search: search || undefined, role: roleFilter || undefined });
  const createUser = useCreateUser();

  // Customers list for assignment dropdown
  const { data: customersData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => customersApi.list({ limit: 100 }).then(r => r.data.data || []),
    enabled: showModal,
  });
  const customersList: any[] = customersData || [];

  const defaultForm = { email:'', password:'', firstName:'', lastName:'', role: 'USER', status:'ACTIVE', customerId:'' };
  const [form, setForm] = useState(defaultForm);

  const handleOpenCreate = () => {
    setForm(defaultForm);
    setEditUser(null);
    setModal(true);
  };

  const handleEdit = (u: any) => {
    setForm({ email: u.email, password:'', firstName: u.firstName, lastName: u.lastName, role: u.role, status: u.status });
    setEditUser(u);
    setModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editUser) {
        await usersApi.update(editUser.id, {
          firstName: form.firstName,
          lastName: form.lastName,
          role: form.role,
          status: form.status,
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success('User updated');
      } else {
        await createUser.mutateAsync({
          ...form,
          ...(form.customerId ? { customerId: form.customerId } : {}),
        });
        toast.success('User created');
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setModal(false);
    } catch(e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<any>[] = [
    { key:'name', header:'Name', render: r => (
      <div>
        <p className="font-medium text-gray-900">{r.firstName} {r.lastName}</p>
        <p className="text-xs text-gray-400">{r.email}</p>
      </div>
    )},
    { key:'role', header:'Role', render: r => (
      <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
        {r.role.replace(/_/g,' ')}
      </span>
    )},
    { key:'status', header:'Status', render: r => <StatusBadge status={r.status} /> },
    { key:'lastLoginAt', header:'Last Login', render: r => r.lastLoginAt
      ? <span className="text-xs text-gray-500">{formatDistanceToNow(new Date(r.lastLoginAt), {addSuffix:true})}</span>
      : <span className="text-xs text-gray-300">Never</span>
    },
    { key:'createdAt', header:'Created', render: r => (
      <span className="text-xs text-gray-400">{format(new Date(r.createdAt),'MMM d, yyyy')}</span>
    )},
    ...(canCreate ? [{
      key:'actions', header:'Actions', render: (r: any) => (
        <button onClick={() => handleEdit(r)} className="text-orange-400 hover:text-orange-600 p-1 rounded">
          <Pencil className="w-4 h-4" />
        </button>
      )
    }] : []),
  ];

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      <PageHeader title="Users" subtitle={data ? `${data.pagination?.total || 0} total` : ''}
        actions={canCreate ? <Button onClick={handleOpenCreate}><Plus className="w-4 h-4"/>Add User</Button> : undefined}
      />
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search users…"
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        {isSuperAdmin && (
          <select value={roleFilter} onChange={e=>setRole(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none bg-white">
            <option value="">All Roles</option>
            {CREATE_ROLES.map(r=><option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
          </select>
        )}
      </div>
      <DataTable columns={columns} data={data?.data||[]} loading={isLoading} keyExtractor={r=>r.id}
        pagination={data?.pagination ? {...data.pagination, onPage: setPage} : undefined}
        emptyMessage="No users found."
      />

      <Modal open={showModal} onClose={()=>setModal(false)}
        title={editUser ? 'Edit User' : 'Create New User'} size="md"
        footer={<>
          <Button variant="secondary" onClick={()=>setModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>
            {editUser ? 'Save Changes' : 'Create User'}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name" value={form.firstName} onChange={e=>setForm(f=>({...f,firstName:e.target.value}))} placeholder="John"/>
            <Input label="Last Name" value={form.lastName} onChange={e=>setForm(f=>({...f,lastName:e.target.value}))} placeholder="Smith"/>
          </div>
          <Input label="Email" type="email" value={form.email} disabled={!!editUser}
            onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="john@company.com"/>
          <Input label={editUser ? "New Password (leave blank to keep current)" : "Password"}
            type="password" value={form.password}
            onChange={e=>setForm(f=>({...f,password:e.target.value}))}
            hint={editUser ? undefined : "Min 8 chars"}/>
          <Select label="Role" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}
            options={roleOptions.map(r=>({value:r, label:r.replace(/_/g,' ')}))}/>
          <Select label="Status" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}
            options={ALL_STATUSES.map(s=>({value:s, label:s}))}/>
          {/* Customer assignment — for COMPANY_ADMIN and USER roles */}
          {(form.role === 'COMPANY_ADMIN' || form.role === 'USER') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assign to Customer {form.role === 'COMPANY_ADMIN' && <span className="text-red-500">*</span>}
              </label>
              <select value={form.customerId} onChange={e=>setForm(f=>({...f,customerId:e.target.value}))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                <option value="">— None —</option>
                {customersList.map((cu:any) => (
                  <option key={cu.id} value={cu.id}>{cu.companyName}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                {form.role === 'COMPANY_ADMIN'
                  ? 'This user will be set as the customer\'s Company Administrator'
                  : 'This user will only be able to create and view tickets for this customer'}
              </p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
