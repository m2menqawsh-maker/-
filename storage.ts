
import { SCHEMA_VERSION, AuditLogItem, Customer } from './types';
import { generateId } from './utils';
import { excelGet, excelSet, excelRemove } from './excelStorage';

const STORAGE_KEYS = [
    'cw_ledger',
    'cw_sessions',
    'cw_records',
    'cw_expenses',
    'cw_purchases',
    'cw_period_lock',
    'cw_audit_logs',
    'cw_settings',
    'cw_customers',
    'cw_users',
    'cw_inventory_items',
    'cw_bank_accounts',
    'cw_drinks',
    'cw_internet_cards',
    'cw_place_loans',
    'cw_partner_debts_list',
    'cw_cash_transfers',
    'cw_system_state',
    'cw_day_cycles',
    'cw_monthly_archives',
    'cw_daily_closings',
    'cw_inventory_snapshots',
    'cw_pricing',
    'cw_saving_plans',
    'cw_saving_goals'
];

export const exportBackup = (): string => {
    const backup: any = {
        meta: {
            version: SCHEMA_VERSION,
            createdAt: new Date().toISOString(),
            appName: "Co'Ma"
        },
        data: {}
    };

    STORAGE_KEYS.forEach(key => {
        const raw = excelGet(key);
        if (raw) {
            try {
                backup.data[key] = JSON.parse(raw);
            } catch (e) {
                console.error(`Failed to parse key ${key}`, e);
            }
        }
    });

    return JSON.stringify(backup, null, 2);
};

export const importBackup = (jsonString: string): { success: boolean; message: string } => {
    try {
        const backup = JSON.parse(jsonString);
        
        if (!backup.meta || !backup.data) {
            return { success: false, message: 'ملف غير صالح: هيكل البيانات غير صحيح' };
        }

        if (backup.meta.version !== SCHEMA_VERSION) {
            console.warn(`Version mismatch. Backup: ${backup.meta.version}, Current: ${SCHEMA_VERSION}. Proceeding carefully.`);
        }

        if (!backup.data['cw_ledger']) {
            return { success: false, message: 'ملف غير صالح: السجل المالي مفقود' };
        }

        STORAGE_KEYS.forEach(key => {
            if (backup.data[key]) {
                excelSet(key, JSON.stringify(backup.data[key]));
            } else {
                excelRemove(key);
            }
        });

        const logs: AuditLogItem[] = backup.data['cw_audit_logs'] || [];
        logs.unshift({
            id: generateId(),
            timestamp: new Date().toISOString(),
            entityType: 'system',
            entityId: 'restore',
            action: 'RESTORE_BACKUP',
            details: `Restored from backup created at ${backup.meta.createdAt}`
        });
        excelSet('cw_audit_logs', JSON.stringify(logs));

        return { success: true, message: 'تم استعادة النسخة الاحتياطية بنجاح' };

    } catch (e) {
        console.error(e);
        return { success: false, message: 'حدث خطأ أثناء معالجة الملف' };
    }
};

export const clearAllData = () => {
    STORAGE_KEYS.forEach(key => excelRemove(key));
    window.location.reload();
};

export const clearTransactionalData = () => {
    const keysToRemove = [
        'cw_ledger',
        'cw_sessions',
        'cw_records',
        'cw_audit_logs',
        'cw_expenses',
        'cw_purchases',
        'cw_day_cycles',
        'cw_daily_closings',
        'cw_cash_transfers',
        'cw_partner_debts_list',
        'cw_period_lock'
    ];

    keysToRemove.forEach(k => excelRemove(k));

    const cleanState = {
        currentDate: new Date().toISOString().split('T')[0],
        currentMonth: new Date().toISOString().slice(0, 7),
        activeCycleId: null,
        currentCycleStartTime: null,
        dayStatus: 'closed',
        monthStatus: 'open',
        logs: [],
        lastBackupDate: null
    };
    excelSet('cw_system_state', JSON.stringify(cleanState));

    const rawCustomers = excelGet('cw_customers');
    if (rawCustomers) {
        try {
            const customers: Customer[] = JSON.parse(rawCustomers);
            const resetCustomers = customers.map(c => ({
                ...c,
                debtBalance: 0,
                creditBalance: 0,
                lastVisit: undefined
            }));
            excelSet('cw_customers', JSON.stringify(resetCustomers));
        } catch (e) {
            console.error("Failed to reset customers", e);
        }
    }

    const rawPlans = excelGet('cw_saving_plans');
    if (rawPlans) {
        try {
            const plans = JSON.parse(rawPlans);
            const updatedPlans = plans.map((p: any) => ({ ...p, lastAppliedAt: new Date().toISOString().split('T')[0] }));
            excelSet('cw_saving_plans', JSON.stringify(updatedPlans));
        } catch (e) { console.error(e); }
    }

    window.location.reload();
};
