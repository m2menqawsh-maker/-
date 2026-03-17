
import { LedgerEntry, TransactionType, FinancialChannel, Record, Expense, Purchase, CashTransfer, DebtItem, PlaceLoan, BankAccount, InventorySnapshot, PricingConfig, DayCycle, PeriodLock, SavingPlan } from './types';
import { generateId, getLocalDate, getDaysInMonth, getAllDaysOfMonth, formatCurrency } from './utils';

// --- SINGLE SOURCE OF TRUTH FOR PARTNERS ---
export const GLOBAL_PARTNERS = [
    { id: 'abu_khaled', name: 'أبو خالد', percent: 34 },
    { id: 'khaled', name: 'خالد', percent: 33 },
    { id: 'abdullah', name: 'عبد الله', percent: 33 }
];

// --- CORE SELECTORS ---

export const getLedgerBalance = (ledger: LedgerEntry[], channel: FinancialChannel, accountId?: string): number => {
    return ledger.reduce((acc, entry) => {
        if (entry.channel !== channel) return acc;
        if (accountId && entry.accountId !== accountId) return acc;

        const isPartnerFundedPurchase = entry.type === TransactionType.PARTNER_DEPOSIT &&
                                         (entry.description.includes('شراء') || entry.description.includes('بضاعة'));

        if (isPartnerFundedPurchase) return acc;
        
        if (entry.direction === 'in') {
            if (channel === 'bank' && entry.transferStatus && entry.transferStatus !== 'confirmed') {
                return acc;
            }
            return acc + (entry.amount || 0);
        }
        if (entry.direction === 'out') return acc - (entry.amount || 0);
        return acc;
    }, 0);
};

export const getSavingsBalance = (ledger: LedgerEntry[], goalId?: string): number => {
    return ledger.reduce((acc, entry) => {
        // If filtering by specific goalId
        if (goalId !== undefined) {
            // Include only if entry.goalId matches.
            // If goalId is 'general', include entries with NO goalId.
            if (goalId === 'general' && entry.goalId) return acc;
            if (goalId !== 'general' && entry.goalId !== goalId) return acc;
        }

        if (entry.type === TransactionType.SAVING_DEPOSIT) return acc + entry.amount;
        if (entry.type === TransactionType.SAVING_WITHDRAWAL) return acc - entry.amount;
        return acc;
    }, 0);
};

export const resolveActorName = (entry: LedgerEntry): string => {
    if (entry.partnerName) return entry.partnerName;
    if (entry.partnerId) {
        const partner = GLOBAL_PARTNERS.find(p => p.id === entry.partnerId);
        if (partner) return partner.name;
    }
    if (entry.senderName) return entry.senderName;

    const types: { [key: string]: string } = {
        [TransactionType.INCOME_SESSION]: "زبون (جلسة)",
        [TransactionType.INCOME_PRODUCT]: "زبون (منتجات)",
        [TransactionType.DEBT_PAYMENT]: "زبون (سداد دين)",
        [TransactionType.DEBT_CREATE]: "زبون (تسجيل دين)",
        [TransactionType.EXPENSE_OPERATIONAL]: "مصاريف تشغيلية",
        [TransactionType.EXPENSE_PURCHASE]: "مشتريات للمكان",
        [TransactionType.LOAN_RECEIPT]: "دائن (قرض)",
        [TransactionType.LOAN_REPAYMENT]: "دائن (سداد)",
        [TransactionType.SAVING_DEPOSIT]: "صندوق الادخار",
        [TransactionType.LIQUIDATION_TO_APP]: "إيداع كاش في البنك"
    };

    return types[entry.type] || 'جهة غير محددة';
};

export const getLedgerTotals = (ledger: LedgerEntry[], period: 'today' | 'month' | 'all', dateKey?: string) => {
    let start = '0000-00-00';
    let end = '9999-99-99';
    const today = dateKey || getLocalDate();

    if (period === 'today') {
        start = today;
        end = today;
    } else if (period === 'month') {
        start = today.slice(0, 7) + '-01';
        end = today.slice(0, 7) + '-31';
    }

    return getLedgerStatsForPeriod(ledger, start, end);
};

export const getCostAnalysisView = (ledger: LedgerEntry[], records: Record[], monthFilter: string) => {
    const days = getAllDaysOfMonth(monthFilter);
    return days.map(day => {
        const stats = getLedgerStatsForPeriod(ledger, day, day);
        const dayRecords = records.filter(r => r.endTime.startsWith(day));
        
        const totalCOGS = dayRecords.reduce((s, r) => s + (r.drinksCost || 0) + (r.internetCardsCost || 0) + (r.placeCost || 0), 0);
        const totalLoanRepayments = ledger.filter(e => e.dateKey === day && e.type === TransactionType.LOAN_REPAYMENT).reduce((s, e) => s + e.amount, 0);
        const totalSavings = ledger.filter(e => e.dateKey === day && e.type === TransactionType.SAVING_DEPOSIT).reduce((s, e) => s + e.amount, 0);
        
        const netProfit = stats.income - (stats.expenses + totalCOGS + totalLoanRepayments + totalSavings);

        return {
            date: day,
            totalRevenue: stats.income,
            totalExpenses: stats.expenses,
            totalCOGS,
            totalLoanRepayments,
            totalSavings,
            netProfit
        };
    }).filter(d => d.totalRevenue > 0 || d.totalExpenses > 0);
};

export const getPartnerDebtSummary = (debts: DebtItem[], partnerId: string) => {
    const items = debts.filter(d => d.partnerId === partnerId).sort((a,b) => b.date.localeCompare(a.date));
    const totalDebt = items.reduce((s, d) => s + d.amount, 0);
    const placeDebt = items.filter(d => d.debtSource === 'place' || !d.debtSource).reduce((s, d) => s + d.amount, 0);
    return { items, totalDebt, placeDebt };
};

export const getPartnerStats = (ledger: LedgerEntry[], partnerId: string) => {
    const entries = ledger.filter(e => e.partnerId === partnerId);
    const withdrawals = entries.filter(e => e.direction === 'out').reduce((s, e) => s + e.amount, 0);
    const repayments = entries.filter(e => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
    const currentNet = withdrawals - repayments;
    return { entries, withdrawals, repayments, currentNet };
};

export const getPlaceLoanStats = (loan: PlaceLoan) => {
    const paid = loan.payments.reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, loan.principal - paid);
    const progress = loan.principal > 0 ? (paid / loan.principal) * 100 : 0;
    return { paid, remaining, progress };
};

export const checkLoanStatusAfterPayment = (loan: PlaceLoan, newPaymentAmount: number): 'active' | 'closed' => {
    const totalPaid = loan.payments.reduce((s, p) => s + p.amount, 0) + newPaymentAmount;
    return totalPaid >= loan.principal ? 'closed' : 'active';
};

export const getTreasuryStats = (ledger: LedgerEntry[], accounts: BankAccount[]) => {
    const cashBalance = getLedgerBalance(ledger, 'cash');
    const accountsStats = accounts.map(acc => {
        const totalIn = ledger.filter(e => e.channel === 'bank' && e.accountId === acc.id && e.direction === 'in' && (e.transferStatus === 'confirmed' || !e.transferStatus)).reduce((s, e) => s + e.amount, 0);
        const totalOut = ledger.filter(e => e.channel === 'bank' && e.accountId === acc.id && e.direction === 'out').reduce((s, e) => s + e.amount, 0);
        return {
            ...acc,
            balance: totalIn - totalOut,
            totalIn,
            totalOut
        };
    });
    const totalBankBalance = accountsStats.reduce((s, a) => s + a.balance, 0);
    return { cashBalance, totalBankBalance, accountsStats };
};

export const getLedgerStatsForPeriod = (ledger: LedgerEntry[], startDate: string, endDate: string) => {
    const periodEntries = ledger.filter(e => e.dateKey >= startDate && e.dateKey <= endDate);
    
    const income = periodEntries
        .filter(e => e.type === TransactionType.INCOME_SESSION || e.type === TransactionType.INCOME_PRODUCT || e.type === TransactionType.DEBT_PAYMENT)
        .reduce((s, e) => s + (e.amount || 0), 0);
    
    const sessionIncome = periodEntries.filter(e => e.type === TransactionType.INCOME_SESSION).reduce((s,e) => s + (e.amount || 0), 0);
    const productIncome = periodEntries.filter(e => e.type === TransactionType.INCOME_PRODUCT).reduce((s,e) => s + (e.amount || 0), 0);
    
    const expenses = 
    periodEntries
        .filter(e => 
            e.type === TransactionType.EXPENSE_OPERATIONAL || 
            e.type === TransactionType.EXPENSE_PURCHASE ||
            (e.type === TransactionType.PARTNER_DEPOSIT && (e.description.includes('شراء') || e.description.includes('بضاعة')))
        )
        .reduce((s, e) => s + (e.amount || 0), 0);
        
    const debtCreated = periodEntries
        .filter(e => e.type === TransactionType.DEBT_CREATE)
        .reduce((s, e) => s + (e.amount || 0), 0);
        
    const debtPaid = periodEntries
        .filter(e => e.type === TransactionType.DEBT_PAYMENT)
        .reduce((s, e) => s + (e.amount || 0), 0);
        
    const netCashFlow = periodEntries.reduce((acc, entry) => {
        if (entry.channel !== 'cash') return acc;
        if (entry.type === TransactionType.PARTNER_DEPOSIT && (entry.description.includes('شراء') || entry.description.includes('بضاعة'))) return acc;
        return entry.direction === 'in' ? acc + entry.amount : acc - entry.amount;
    }, 0);

    return { 
        income, sessionIncome, productIncome, expenses, debtCreated, debtPaid, 
        totalNetCash: getLedgerBalance(ledger, 'cash'), 
        totalNetBank: getLedgerBalance(ledger, 'bank'), 
        netCashFlow
    };
};

export const calcLedgerInventory = (
    ledger: LedgerEntry[], 
    records: Record[], 
    startDate: string, 
    endDate: string, 
    expenses: Expense[], 
    pricingConfig: PricingConfig, 
    electricityCost: number = 0, 
    lastInventoryAt?: string,
    savingPlans: SavingPlan[] = [],
    placeLoans: PlaceLoan[] = []
): InventorySnapshot => {
    
    const periodEntries = ledger.filter(e => {
        if (e.dateKey > endDate) return false; 
        if (lastInventoryAt && e.timestamp && e.timestamp <= lastInventoryAt) return false;
        return true;
    });
    
    const isPhysicalIn = (e: LedgerEntry) => {
        if (e.direction !== 'in') return false;
        if (e.type === TransactionType.PARTNER_DEPOSIT && (e.description.includes('شراء') || e.description.includes('بضاعة'))) return false;
        return true;
    };

    const cashIn = periodEntries.filter(e => e.channel === 'cash' && isPhysicalIn(e)).reduce((s,e) => s + e.amount, 0);
    const bankIn = periodEntries.filter(e => e.channel === 'bank' && isPhysicalIn(e) && (e.transferStatus === 'confirmed' || !e.transferStatus)).reduce((s,e) => s + e.amount, 0);
    const cashOut = periodEntries.filter(e => e.channel === 'cash' && e.direction === 'out').reduce((s,e) => s + e.amount, 0);
    const bankOut = periodEntries.filter(e => e.channel === 'bank' && e.direction === 'out').reduce((s,e) => s + e.amount, 0);

    const netCashInPlace = cashIn - cashOut;
    const netBankInPlace = bankIn - bankOut;

    const daysInMonth = getDaysInMonth(startDate);

    // 1. Calculate Distributed Expenses (Already implemented)
    const distributedFixedExpenses = savingPlans
        .filter(p => p.category === 'expense' && p.isActive)
        .reduce((sum, p) => {
            if (p.lastAppliedAt >= endDate) return sum; 
            const dailyRate = p.amount / daysInMonth;
            const planEffectiveStart = p.lastAppliedAt > startDate ? p.lastAppliedAt : startDate;
            if (planEffectiveStart > endDate) return sum; 
            const pStartD = new Date(planEffectiveStart);
            const pEndD = new Date(endDate);
            const pDiffTime = pEndD.getTime() - pStartD.getTime();
            let planDaysCount = Math.ceil(pDiffTime / (1000 * 60 * 60 * 24));
            if (planEffectiveStart === endDate) planDaysCount = 1;
            if (planDaysCount < 0) planDaysCount = 0;
            return sum + (dailyRate * planDaysCount);
        }, 0);

    // 2. Calculate Distributed Savings (Theoretical for display)
    const distributedSavings = savingPlans
        .filter(p => p.category === 'saving' && p.isActive)
        .reduce((sum, p) => {
            if (p.lastAppliedAt >= endDate) return sum; 
            
            // Re-using logic from expenses to prorate daily savings or check monthly
            if (p.type === 'daily_saving') {
                const planEffectiveStart = p.lastAppliedAt > startDate ? p.lastAppliedAt : startDate;
                const pStartD = new Date(planEffectiveStart);
                const pEndD = new Date(endDate);
                const pDiffTime = pEndD.getTime() - pStartD.getTime();
                let planDaysCount = Math.ceil(pDiffTime / (1000 * 60 * 60 * 24));
                if (planEffectiveStart === endDate) planDaysCount = 1;
                return sum + (p.amount * planDaysCount);
            }
            if (p.type === 'monthly_payment') {
                // If it's a new month since last applied, add the full amount
                if (endDate.slice(0, 7) > p.lastAppliedAt.slice(0, 7)) {
                    return sum + p.amount;
                }
            }
            return sum;
        }, 0);

    // 3. Calculate Due Loan Installments (Theoretical for display)
    const dueInstallments = placeLoans.reduce((sum, loan) => {
        if (loan.status === 'closed') return sum;
        const dueInPeriod = loan.installments.filter(i => 
            i.dueDate >= startDate && i.dueDate <= endDate && i.status !== 'paid'
        ).reduce((s, i) => s + i.amount, 0);
        return sum + dueInPeriod;
    }, 0);

    const periodRecords = records.filter(r => {
        const rDate = r.endTime.split('T')[0];
        if (rDate > endDate) return false;
        if (lastInventoryAt && r.endTime && r.endTime <= lastInventoryAt) return false;
        return true;
    });

    const totalCOGS = periodRecords.reduce((s, r) => s + (r.drinksCost || 0) + (r.internetCardsCost || 0) + (r.placeCost || 0), 0);
    
    const totalOpsExpenses = 
    // periodEntries.filter(e => 
    //     e.type === TransactionType.EXPENSE_OPERATIONAL || 
    //     e.type === TransactionType.EXPENSE_PURCHASE ||
    //     (e.type === TransactionType.PARTNER_DEPOSIT && (e.description.includes('شراء') || e.description.includes('بضاعة')))
    // ).reduce((s, e) => s + e.amount, 0) + 
    electricityCost + distributedFixedExpenses;

    const ledgerLoanRepayments = periodEntries.filter(e => e.type === TransactionType.LOAN_REPAYMENT).reduce((s, e) => s + e.amount, 0);
    const ledgerSavings = periodEntries.filter(e => e.type === TransactionType.SAVING_DEPOSIT).reduce((s, e) => s + e.amount, 0);

    // Combine Actual Ledger + Theoretical for the "Total Deducted" view
    const totalLoanRepayments = ledgerLoanRepayments + dueInstallments;
    const totalSavings = ledgerSavings + distributedSavings;

    const totalRevenue = periodEntries.filter(e => 
        e.type === TransactionType.INCOME_SESSION || 
        e.type === TransactionType.INCOME_PRODUCT || 
        e.type === TransactionType.DEBT_PAYMENT
    ).reduce((s,e) => s+e.amount, 0);
    
    const netProfitPaid = totalRevenue - (totalOpsExpenses + totalCOGS);// + totalLoanRepayments + totalSavings
    const devCut = netProfitPaid > 0 ? netProfitPaid * (pricingConfig.devPercent / 100) : 0;
    const distributableProfit = netProfitPaid - devCut;

    const partners = GLOBAL_PARTNERS.map(p => {
        const baseShare = Math.max(0, distributableProfit * (p.percent / 100));
        const myPurchases = periodEntries.filter(e => e.partnerId === p.id && e.type === TransactionType.PARTNER_DEPOSIT && e.description.includes('شراء')).reduce((s,e) => s+e.amount, 0);
        const myWithdrawals = periodEntries.filter(e => e.partnerId === p.id && e.type === TransactionType.PARTNER_WITHDRAWAL).reduce((s,e) => s+e.amount, 0);

        const opsNetCash = netCashInPlace + myPurchases + myWithdrawals;
        const totalOpsNet = opsNetCash + netBankInPlace;
        const cashRatio = totalOpsNet > 0 ? Math.max(0, opsNetCash) / totalOpsNet : 0.5;
        const bankRatio = 1 - cashRatio;

        const finalPayoutCash = (baseShare * cashRatio) + myPurchases - myWithdrawals;
        const finalPayoutBank = (baseShare * bankRatio);

        return {
            name: p.name, sharePercent: p.percent / 100, baseShare,
            cashShareAvailable: baseShare * cashRatio, bankShareAvailable: baseShare * bankRatio,
            purchasesReimbursement: myPurchases, loanRepaymentCash: 0, loanRepaymentBank: 0,
            placeDebtDeducted: myWithdrawals, finalPayoutCash, finalPayoutBank,
            finalPayoutTotal: finalPayoutCash + finalPayoutBank, remainingDebt: 0
        };
    });

    // return {
    //     id: generateId(), type: 'manual', archiveId: 'SNAP-' + generateId(), archiveDate: new Date().toISOString(),
    //     periodStart: startDate, periodEnd: endDate, createdAt: Date.now(), 
    //     totalPaidRevenue: totalRevenue, totalCashRevenue: cashIn, totalBankRevenue: bankIn,
    //     totalDiscounts: 0, totalDebtRevenue: 0, totalInvoice: totalRevenue,
    //     totalPlaceCost: periodRecords.reduce((s,r) => s+(r.placeCost||0), 0),
    //     totalDrinksCost: periodRecords.reduce((s,r) => s+(r.drinksCost||0), 0),
    //     totalCardsCost: periodRecords.reduce((s,r) => s+(r.internetCardsCost||0), 0),
    //     totalExpenses: totalOpsExpenses, totalCOGS, totalLoanRepayments, totalSavings, electricityCost,
    //     totalCashExpenses: cashOut, totalBankExpenses: bankOut, netCashInPlace, netBankInPlace,
    //     grossProfit: netProfitPaid + devCut, devCut, netProfitPaid: distributableProfit, devPercentSnapshot: pricingConfig.devPercent, partners,
    //     expensesDetails: { fixed: [], oneTime: [], autoPurchases: [], loanRepayments: [] }
    // };

    return {
        id: generateId(),
        type: 'manual',
        archiveId: 'SNAP-' + generateId(),
        archiveDate: new Date().toISOString(),

        periodStart: startDate,
        periodEnd: endDate,
        createdAt: Date.now(),

        totalPaidRevenue: totalRevenue,
        totalCashRevenue: cashIn,
        totalBankRevenue: bankIn,

        totalDiscounts: 0,
        totalDebtRevenue: 0,
        totalInvoice: totalRevenue,

        totalPlaceCost: periodRecords.reduce(
            (s, r) => s + (r.placeCost || 0),
            0
        ),
        totalDrinksCost: periodRecords.reduce(
            (s, r) => s + (r.drinksCost || 0),
            0
        ),
        totalCardsCost: periodRecords.reduce(
            (s, r) => s + (r.internetCardsCost || 0),
            0
        ),

        totalExpenses: totalOpsExpenses,
        totalCOGS,
        totalLoanRepayments,
        totalSavings,
        electricityCost,

        totalCashExpenses: cashOut,
        totalBankExpenses: bankOut,
        netCashInPlace,
        netBankInPlace,

        grossProfit: netProfitPaid + devCut,
        devCut,
        netProfitPaid: distributableProfit,
        devPercentSnapshot: pricingConfig.devPercent,
        partners,

        expensesDetails: {
            fixed: [],
            oneTime: [],
            autoPurchases: [],
            loanRepayments: []
        }
    };



};

export const validateTransaction = (ledger: LedgerEntry[], amount: number, channel: FinancialChannel, accountId?: string) => {
    const balance = getLedgerBalance(ledger, channel, accountId);
    if (balance < amount) {
        throw new Error(`رصيد ${channel === 'cash' ? 'الكاش' : 'البنك'} غير كافٍ. الرصيد الحالي: ${formatCurrency(balance)}`);
    }
};

export const createEntry = (
    type: TransactionType,
    amount: number,
    direction: 'in' | 'out',
    channel: FinancialChannel,
    description: string,
    accountId?: string,
    entityId?: string,
    partnerId?: string,
    dateKey?: string,
    referenceId?: string,
    partnerName?: string,
    performedById?: string,
    performedByName?: string,
    goalId?: string // Added goalId
): LedgerEntry => ({
    id: generateId(),
    timestamp: new Date().toISOString(),
    dateKey: dateKey || getLocalDate(),
    type,
    amount,
    direction,
    channel,
    accountId,
    entityId,
    description,
    partnerId,
    partnerName,
    referenceId,
    performedById,
    performedByName,
    goalId
});

export const calcEndDayPreviewFromLedger = (ledger: LedgerEntry[], startTime: string, bankAccounts: BankAccount[], config: PricingConfig) => {
    const today = getLocalDate();
    const stats = getLedgerStatsForPeriod(ledger, today, today);
    const bankBreakdown = bankAccounts.map(acc => ({
        bankName: acc.name,
        amount: getLedgerBalance(ledger, 'bank', acc.id)
    })).filter(b => b.amount !== 0);

    return {
        totalRevenue: stats.income,
        cashRevenue: stats.sessionIncome + stats.productIncome,
        bankRevenue: stats.totalNetBank,
        totalDebt: stats.debtCreated,
        netCashFlow: stats.netCashFlow,
        recordCount: 0,
        bankBreakdown
    };
};

// Fixed validateOperation to prevent orphaned expenses
export const validateOperation = (date: string, lock: PeriodLock | null, lastInventoryDate?: string | null) => {
    if (lock && date <= lock.lockedUntil) {
        throw new Error(`الفترة المالية مغلقة حتى تاريخ ${lock.lockedUntil}. لا يمكن إجراء عمليات في هذا التاريخ.`);
    }
    // Allow operations on the same day as the last inventory (strict check < instead of <=)
    if (lastInventoryDate && date < lastInventoryDate) {
        throw new Error(`لا يمكن إضافة/تعديل عمليات بتاريخ ${date} لأنه تم أرشفة الجرد حتى ${lastInventoryDate}. لمنع الأخطاء المحاسبية، يرجى إضافة العملية بتاريخ اليوم الحالي.`);
    }
};

export const processAutoSavings = (plans: SavingPlan[], ledger: LedgerEntry[], date: string) => {
    const entries: LedgerEntry[] = [];
    const updatedPlans = plans.map(plan => {
        if (!plan.isActive) return plan;
        const lastApplied = plan.lastAppliedAt;
        if (lastApplied >= date) return plan;
        
        // Pass goalId to createEntry if it exists on the plan
        if (plan.type === 'daily_saving') {
            entries.push(createEntry(TransactionType.SAVING_DEPOSIT, plan.amount, 'out', plan.channel, `ادخار تلقائي: ${plan.name || 'خطة ادخار'}`, plan.bankAccountId, undefined, undefined, date, undefined, undefined, undefined, undefined, plan.goalId));
            return { ...plan, lastAppliedAt: date };
        }
        if (plan.type === 'monthly_payment') {
            const currentMonth = date.slice(0, 7);
            const lastMonth = lastApplied.slice(0, 7);
            if (currentMonth > lastMonth) {
                entries.push(createEntry(TransactionType.SAVING_DEPOSIT, plan.amount, 'out', plan.channel, `ادخار شهري: ${plan.name || 'خطة ادخار'}`, plan.bankAccountId, undefined, undefined, date, undefined, undefined, undefined, undefined, plan.goalId));
                return { ...plan, lastAppliedAt: date };
            }
        }
        return plan;
    });
    return { entries, updatedPlans };
};

export const migrateLegacyDataToLedger = (records: Record[], expenses: Expense[], cashTransfers: CashTransfer[], debts: DebtItem[], loans: PlaceLoan[]): LedgerEntry[] => {
    return [];
};

export const checkLedgerIntegrity = (ledger: LedgerEntry[]): string[] => {
    const errors: string[] = [];
    if (ledger.some(e => !e.amount || e.amount < 0)) errors.push("يوجد عمليات بمبالغ غير صحيحة");
    return errors;
};

export const getExpensesPageStats = (purchases: Purchase[], plans: SavingPlan[], monthKey: string) => {
    const totalDaily = purchases.filter(p => p.date.startsWith(monthKey)).reduce((sum, p) => sum + p.amount, 0);
    const fixedPlans = plans.filter(p => p.category === 'expense' && p.isActive);
    const totalFixedMonthly = fixedPlans.reduce((sum, p) => sum + p.amount, 0);
    const totalDailyFixed = fixedPlans.filter(p => p.type === 'daily_saving').reduce((sum, p) => sum + p.amount, 0);
    return { totalDaily, totalFixedMonthly, totalDailyFixed };
};

export const getSnapshotDistributionTotals = (snap: InventorySnapshot) => {
    const totalCashDist = snap.partners.reduce((s, p) => s + (p.finalPayoutCash || 0), 0);
    const totalBankDist = snap.partners.reduce((s, p) => s + (p.finalPayoutBank || 0), 0);
    return { totalCashDist, totalBankDist };
};
