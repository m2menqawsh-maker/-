
import React, { useState, useMemo, useEffect } from 'react';
import { Session, Record, ViewState, Order, DeviceStatus, Expense, Purchase, InventorySnapshot, DrinkSize, DebtItem, Transaction, DayCycle, Customer, Discount, PlaceLoan, CashTransfer, LedgerEntry, TransactionType, PeriodLock, AppUser, SavingPlan, InventoryItem, InventoryMovement, SystemState } from './types';
import { excelSet } from './excelStorage';
import { generateId, getCurrentTimeOnly, mergeDateAndTime, getLocalDate, getDaysInMonth, formatCurrency, formatDuration, calculateDrinkCost } from './utils';
import { calcRecordFinancials, calculateCustomerTransaction } from './accounting';
import { validateTransaction, createEntry, calcLedgerInventory, calcEndDayPreviewFromLedger, validateOperation, GLOBAL_PARTNERS, processAutoSavings } from './accounting_core';
import { useAppState } from './hooks/useAppState';

import Layout from './components/ui/Layout';
import Toast from './components/ui/Toast';
import Dashboard from './pages/Dashboard';
import RecordsList from './pages/RecordsList';
import Settings from './pages/Settings';
import CostAnalysis from './pages/CostAnalysis';
import ProfitDistribution from './pages/ProfitDistribution';
import InventoryArchive from './pages/InventoryArchive';
import DrinksPage from './pages/DrinksPage';
import InventoryPage from './pages/InventoryPage';
import ExpensesPage from './pages/ExpensesPage';
import PartnerDebtsPage from './pages/PartnerDebtsPage';
import InternetCardsPage from './pages/InternetCardsPage';
import TreasuryPage from './pages/TreasuryPage';
import VipCustomersPage from './pages/VipCustomersPage';
import LiabilitiesPage from './pages/LiabilitiesPage';
import PartnersPage from './pages/PartnersPage';
import BankAccountsPage from './pages/BankAccountsPage';
import LedgerViewerPage from './pages/LedgerViewerPage';
import AuditLogPage from './pages/AuditLogPage';
import BackupRestorePage from './pages/BackupRestorePage';
import UsersPage from './pages/UsersPage';
import LoginPage from './components/auth/LoginPage';

import Modal from './components/ui/Modal';
import Button from './components/ui/Button';
import FormInput from './components/ui/FormInput';
import { Lock, Search, Star, ArrowRightLeft, Percent, CreditCard, AlertTriangle, CheckCircle, X, Gauge, Zap, ArrowRight, ArrowDown, Banknote, Landmark, ChevronLeft, ShieldCheck, UserCheck, Calculator, Box, Info, Save, Trash2, RotateCcw, Coins, TrendingUp, TrendingDown, ShoppingBag, PiggyBank, Clock, Wallet, MinusCircle, Users, Check, Circle } from 'lucide-react';

const App: React.FC = () => {
    const [activeView, setActiveView] = useState<ViewState>('dashboard');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [modals, setModals] = useState({ addSession: false, checkout: false, addOrder: false, inventory: false, endDay: false, audit: false, profile: false, inventoryConfirm: false });
    const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

    const [newSessionData, setNewSessionData] = useState({ name: '', phone: '', time: getCurrentTimeOnly(), device: 'mobile' as DeviceStatus, notes: '', isVIP: false });
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');

    const [checkoutData, setCheckoutData] = useState<{
        sessions: Session[],
        primarySessionId: string | null, // Added to track who pays
        time: string,
        cash: string,
        bank: string,
        bankAccountId: string,
        senderPhone: string,
        senderAccountName: string,
        excuse: string,
        discount: Discount | undefined
    }>({
        sessions: [], primarySessionId: null, time: '', cash: '', bank: '', bankAccountId: '', senderPhone: '', senderAccountName: '', excuse: '', discount: undefined
    });

    const [orderData, setOrderData] = useState<{
        target: Session | Record | null,
        orderIdToEdit: string | null,
        type: 'drink' | 'internet_card',
        itemId: string,
        size: DrinkSize,
        qty: string,
        time: string,
        lockType?: boolean
    }>({ target: null, orderIdToEdit: null, type: 'drink', itemId: '', size: 'small', qty: '1', time: '' });

    const [endDayData, setEndDayData] = useState<any>(null);
    const [endDayNotes, setEndDayNotes] = useState('');
    const [inventoryRange, setInventoryRange] = useState({ start: '', end: '' });
    const [inventoryPreview, setInventoryPreview] = useState<any>(null);

    const [currentMeterReading, setCurrentMeterReading] = useState('');

    const [pendingAutoSavings, setPendingAutoSavings] = useState<{ entries: LedgerEntry[], updatedPlans: SavingPlan[] } | null>(null);

    const [profileData, setProfileData] = useState({ name: '', username: '', password: '' });

    const {
        sessions, setSessions,
        records, setRecords,
        auditLogs,
        drinks, setDrinks,
        internetCards, setInternetCards,
        bankAccounts, setBankAccounts,
        expenses, setExpenses,
        purchases, setPurchases,
        inventorySnapshots, setInventorySnapshots,
        inventoryItems, setInventoryItems,
        customers, setCustomers,
        placeLoans, setPlaceLoans,
        cashTransfers, setCashTransfers,
        savingPlans, setSavingPlans,
        savingGoals, setSavingGoals,
        periodLock, setPeriodLock,
        ledger, setLedger,
        dayCycles, setDayCycles,
        dailyClosings,
        systemState, setSystemState,
        pricingConfig, setPricingConfig,
        debtsList, setDebtsList,
        integrityErrors,
        daysSinceBackup,
        logAction,
        users, addUser, updateUser, deleteUser,
        currentUser, login, logout
    } = useAppState();

    const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const getPerformer = () => ({
        performedById: currentUser?.id,
        performedByName: currentUser?.name
    });

    // Calculated financials for ALL selected sessions
    const checkoutFinancials = useMemo(() => {
        if (checkoutData.sessions.length === 0 || !modals.checkout) return null;
        
        const endIso = mergeDateAndTime(systemState.currentDate, checkoutData.time);
        
        // 1. Calculate Raw Totals First (to determine weights for discount distribution)
        const rawCalculations = checkoutData.sessions.map(session => {
             const f = calcRecordFinancials(session, endIso, pricingConfig, undefined, undefined); 
             return { session, rawFinancials: f };
        });

        const totalRawInvoice = rawCalculations.reduce((sum, item) => sum + (item.rawFinancials.totalInvoice || 0), 0);

        // 2. Prepare Discount Distribution
        let distributedDiscounts: Map<string, Discount> = new Map();
        
        if (checkoutData.discount) {
            if (checkoutData.discount.type === 'percent') {
                // Percentage applies equally to all
                checkoutData.sessions.forEach(s => distributedDiscounts.set(s.id, checkoutData.discount!));
            } else {
                // Fixed Amount: Distribute proportionally based on Raw Invoice
                const safeTotal = totalRawInvoice || 1; 
                let remainingDiscount = checkoutData.discount.value;
                
                rawCalculations.forEach((item, idx) => {
                    const ratio = (item.rawFinancials.totalInvoice || 0) / safeTotal;
                    // Pro-rate discount
                    let share = Math.round(checkoutData.discount!.value * ratio * 100) / 100;
                    
                    // Adjust last item to absorb rounding errors
                    if (idx === rawCalculations.length - 1) {
                        share = Math.round(remainingDiscount * 100) / 100;
                    } else {
                        remainingDiscount -= share;
                    }
                    
                    // Only apply if share is positive
                    if (share > 0) {
                        distributedDiscounts.set(item.session.id, {
                            type: 'fixed',
                            value: share,
                            amount: share,
                            locked: true
                        });
                    }
                });
            }
        }

        // 3. Final Pass with Distributed Discounts
        let grandTotalDue = 0;
        let grandTotalInvoice = 0;
        let totalDiscountApplied = 0;
        let aggregatedStats = {
            totalDuration: 0,
            totalSessionCost: 0,
            totalDrinksCost: 0,
            totalCardsCost: 0
        };

        const individualResults = checkoutData.sessions.map(session => {
            const specificDiscount = distributedDiscounts.get(session.id);
            const financials = calcRecordFinancials(session, endIso, pricingConfig, undefined, specificDiscount); // Pass specific discount
            
            grandTotalDue += financials.totalInvoice || 0;
            grandTotalInvoice += financials.totalInvoice || 0;
            if (financials.discountApplied) {
                totalDiscountApplied += financials.discountApplied.amount;
            }
            
            aggregatedStats.totalDuration += financials.durationMinutes || 0;
            aggregatedStats.totalSessionCost += financials.sessionInvoice || 0;
            aggregatedStats.totalDrinksCost += financials.drinksInvoice || 0;
            aggregatedStats.totalCardsCost += financials.internetCardsInvoice || 0;

            return { session, financials };
        });

        // Calculate Customer Transaction based on Grand Total
        const cash = parseFloat(checkoutData.cash) || 0;
        const bank = parseFloat(checkoutData.bank) || 0;
        const totalPaid = cash + bank;
        
        return {
            grandTotalDue,
            grandTotalInvoice,
            totalPaid,
            aggregatedStats,
            individualResults,
            totalDiscountApplied
        };
    }, [checkoutData, modals.checkout, pricingConfig, systemState.currentDate, customers]);

    useEffect(() => {
        if (modals.inventory && inventoryRange.start) {
            const reading = parseFloat(currentMeterReading) || pricingConfig.lastMeterReading || 0;
            const delta = Math.max(0, reading - (pricingConfig.lastMeterReading || 0));
            const elecCost = delta * (pricingConfig.kwhPrice || 0);

            const effectiveLedger = [...ledger];
            const preview = calcLedgerInventory(effectiveLedger, records, inventoryRange.start, inventoryRange.end, expenses, pricingConfig, elecCost, systemState.lastInventoryAt, savingPlans, placeLoans);

            setInventoryPreview({
                ...preview,
                startMeterReading: pricingConfig.lastMeterReading,
                endMeterReading: reading,
                electricityCost: elecCost
            });
        }
    }, [currentMeterReading, modals.inventory, pricingConfig, ledger, records, inventoryRange, expenses, pendingAutoSavings, savingPlans, placeLoans]);

    const canSubmitCheckout = useMemo(() => {
        if (checkoutData.sessions.length === 0) return false;
        if (checkoutData.sessions.length > 1 && !checkoutData.primarySessionId) return false; // Must select primary
        const bankVal = parseFloat(checkoutData.bank) || 0;
        if (bankVal > 0) { if (!checkoutData.bankAccountId || !checkoutData.senderPhone || !checkoutData.senderAccountName) return false; }
        return true;
    }, [checkoutData]);

    const filteredCustomers = useMemo(() => {
        if (!customerSearch.trim()) return [];
        return customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone.includes(customerSearch)).slice(0, 5);
    }, [customerSearch, customers]);

    const orderModalStockStatus = useMemo(() => {
        const qty = parseInt(orderData.qty) || 1;

        if (orderData.type === 'drink' && orderData.itemId) {
            const drink = drinks.find(d => d.id === orderData.itemId);
            if (!drink || !drink.components) return null;

            return drink.components.map(comp => {
                const invItem = inventoryItems.find(i => i.id === comp.itemId);
                const needed = comp.qty * qty;
                const available = invItem?.qty || 0;
                return {
                    name: invItem?.name || 'صنف محذوف',
                    unit: invItem?.unit || '',
                    available,
                    needed,
                    isShort: available < needed
                };
            });
        }

        if (orderData.type === 'internet_card' && orderData.itemId) {
            const card = internetCards.find(c => c.id === orderData.itemId);
            if (!card || !card.inventoryItemId) return null;

            const invItem = inventoryItems.find(i => i.id === card.inventoryItemId);
            const deductionPerCard = card.deductionAmount || 1;
            const needed = qty * deductionPerCard;
            const available = invItem?.qty || 0;

            return [{
                name: invItem?.name || 'صنف محذوف',
                unit: 'رزمة/وحدة',
                available,
                needed,
                isShort: available < needed
            }];
        }

        return null;
    }, [orderData.itemId, orderData.type, orderData.qty, drinks, internetCards, inventoryItems]);

    const canSaveOrder = useMemo(() => {
        if (!orderData.itemId) return false;
        if (!orderModalStockStatus) return true;
        return !orderModalStockStatus.some(s => s.available < s.needed);
    }, [orderData.itemId, orderModalStockStatus]);

    if (!currentUser) {
        return (
            <>
                {toast && <Toast msg={toast.msg} type={toast.type} />}
                <LoginPage onLogin={login} />
            </>
        );
    }

    const handleBackupComplete = () => {
        setSystemState(prev => ({
            ...prev,
            lastBackupDate: new Date().toISOString()
        }));
        showToast('تم تحديث تاريخ آخر نسخ احتياطي', 'success');
    };
    const handleDeletePurchase = (purchaseId: string) => { const purchase = purchases.find(p => p.id === purchaseId); if (!purchase) return; try { validateOperation(purchase.date || getLocalDate(), periodLock, systemState.lastInventoryDate); const linkedExpense = expenses.find(e => e.id && e.linkedPurchaseId === purchaseId); if (linkedExpense) { setExpenses(prev => prev.filter(e => e.id !== linkedExpense.id)); setLedger(prev => prev.filter(e => e.entityId !== linkedExpense.id)); } setLedger(prev => prev.filter(e => e.entityId !== purchaseId)); if ((purchase as any).stockItemId && (purchase as any).stockQty) { const stockItemId = (purchase as any).stockItemId as string; const stockQty = (purchase as any).stockQty as number; setInventoryItems(prev => prev.map(it => { if (it.id !== stockItemId) return it; const newQty = Math.max(0, (it.qty || 0) - stockQty); const movement = { id: generateId(), date: new Date().toISOString(), qty: -Math.abs(stockQty), type: 'out' as const, notes: `تراجع عن توريد: ${purchase.name}` }; return { ...it, qty: newQty, movements: [...(it.movements || []), movement] }; })); logAction('inventory', (purchase as any).stockItemId, 'REVERT_SUPPLY', `Reverted supply ${(purchase as any).stockQty} due to purchase deletion`); } setPurchases(prev => prev.filter(p => p.id !== purchaseId)); logAction('ledger', purchaseId, 'DELETE_PURCHASE', 'Deleted purchase and cleanup ledger'); showToast('تم حذف المشتريات وتأثيرها المالي بنجاح'); } catch (err: any) { showToast(err.message, 'error'); } };
    const handleDeleteExpense = (expenseId: string) => { const exp = expenses.find(e => e.id === expenseId); if (!exp) return; try { validateOperation(exp.date || getLocalDate(), periodLock, systemState.lastInventoryDate); if (exp.linkedPurchaseId) { setLedger(prev => prev.filter(e => e.entityId !== exp.linkedPurchaseId)); setPurchases(prev => prev.filter(p => p.id !== exp.linkedPurchaseId)); logAction('ledger', exp.linkedPurchaseId, 'DELETE_PURCHASE_VIA_EXPENSE', 'Deleted purchase via expense deletion'); } else { setLedger(prev => prev.filter(e => e.entityId !== expenseId)); } setExpenses(prev => prev.filter(e => e.id !== expenseId)); logAction('ledger', expenseId, 'DELETE_EXPENSE', 'Deleted expense'); showToast('تم حذف المصروف (والمشتريات المرتبطة) بنجاح'); } catch (err: any) { showToast(err.message, 'error'); } };
    const handleDeleteSavingPlan = (planId: string) => { setSavingPlans(prev => prev.filter(p => p.id !== planId)); showToast('تم حذف الخطة'); };
    const handleAddExpense = (newExpense: Expense) => { try { validateOperation(newExpense.date || getLocalDate(), periodLock, systemState.lastInventoryDate); const u = getPerformer(); if (newExpense.type !== 'fixed') { const channel = newExpense.paymentMethod || 'cash'; validateTransaction(ledger, newExpense.amount, channel, newExpense.fromAccountId); } const entry = createEntry(TransactionType.EXPENSE_OPERATIONAL, newExpense.amount, 'out', newExpense.paymentMethod || 'cash', newExpense.name, newExpense.fromAccountId, newExpense.id, undefined, newExpense.date, undefined, undefined, u.performedById, u.performedByName); setLedger(prev => [entry, ...prev]); setExpenses(prev => [...prev, { ...newExpense, ...u }]); logAction('ledger', entry.id, 'ADD_EXPENSE', `Added expense: ${newExpense.name} (${newExpense.amount})`); showToast('تم تسجيل المصروف بنجاح'); } catch (err: any) { showToast(err.message, 'error'); } };
    const handleAddPurchase = (newPurchase: Purchase, newExpense?: Expense) => { try { validateOperation(newPurchase.date, periodLock, systemState.lastInventoryDate); const u = getPerformer(); const newEntries: LedgerEntry[] = []; if (newPurchase.fundingSource === 'place') { const channel = newPurchase.paymentMethod || 'cash'; validateTransaction(ledger, newPurchase.amount, channel, newPurchase.fromAccountId); const entry = createEntry(TransactionType.EXPENSE_PURCHASE, newPurchase.amount, 'out', channel, `شراء: ${newPurchase.name}`, newPurchase.fromAccountId, newPurchase.id, undefined, newPurchase.date, undefined, undefined, u.performedById, u.performedByName); newEntries.push(entry); } else if (newPurchase.fundingSource === 'partner') { const partnerName = GLOBAL_PARTNERS.find(p => p.id === newPurchase.buyer)?.name; const methodLabel = newPurchase.paymentMethod === 'bank' ? 'تحويل بنكي' : 'كاش'; const actualChannel = newPurchase.paymentMethod || 'cash'; const entry = createEntry(TransactionType.PARTNER_DEPOSIT, newPurchase.amount, 'in', actualChannel, `شراء للمكان: ${newPurchase.name} (${methodLabel})`, undefined, newPurchase.id, newPurchase.buyer, newPurchase.date, undefined, partnerName, u.performedById, u.performedByName); newEntries.push(entry); } setLedger(prev => [...newEntries, ...prev]); setPurchases(prev => [...prev, { ...newPurchase, ...u }]); if (newExpense) setExpenses(prev => [...prev, { ...newExpense, ...u }]); logAction('ledger', newPurchase.id, 'ADD_PURCHASE', `Added purchase: ${newPurchase.name}`); showToast('تم تسجيل المشتريات بنجاح'); } catch (err: any) { showToast(err.message, 'error'); } };
    const handleAddPlaceLoan = (newLoan: PlaceLoan) => { try { validateOperation(newLoan.startDate, periodLock, systemState.lastInventoryDate); const u = getPerformer(); setPlaceLoans(prev => [...prev, { ...newLoan, ...u }]); if (newLoan.loanType === 'operational') { const entry = createEntry(TransactionType.LOAN_RECEIPT, newLoan.principal, 'in', newLoan.channel, `استلام دين تشغيلي: ${newLoan.lenderName} (${newLoan.reason})`, newLoan.accountId, newLoan.id, undefined, newLoan.startDate, undefined, undefined, u.performedById, u.performedByName); setLedger(prev => [entry, ...prev]); logAction('loan', newLoan.id, 'ADD_LOAN_OP', `Added operational loan: ${newLoan.principal}`); showToast('تم إضافة الدين التشغيلي وإيداع المبلغ في الرصيد'); } else { logAction('loan', newLoan.id, 'ADD_LOAN_DEV', `Added development loan: ${newLoan.principal}`); showToast('تم إضافة الدين التطويري (التزام)'); } } catch (err: any) { showToast(err.message, 'error'); } };
    const handlePayLoanInstallment = (updatedLoan: PlaceLoan, newExpense: Expense) => { try { validateOperation(newExpense.date || getLocalDate(), periodLock, systemState.lastInventoryDate); const u = getPerformer(); const channel = newExpense.paymentMethod || 'cash'; validateTransaction(ledger, newExpense.amount, channel, newExpense.fromAccountId); const entry = createEntry(TransactionType.LOAN_REPAYMENT, newExpense.amount, 'out', channel, newExpense.name, newExpense.fromAccountId, newExpense.id, undefined, newExpense.date, undefined, undefined, u.performedById, u.performedByName); setLedger(prev => [entry, ...prev]); setPlaceLoans(prev => prev.map(l => l.id === updatedLoan.id ? updatedLoan : l)); setExpenses(prev => [...prev, { ...newExpense, ...u }]); logAction('loan', updatedLoan.id, 'PAY_INSTALLMENT', `Paid ${newExpense.amount} for loan ${updatedLoan.lenderName}`); showToast('تم سداد القسط بنجاح'); } catch (err: any) { showToast(err.message, 'error'); } };
    const handleAddPartnerDebt = (newDebt: DebtItem) => { try { validateOperation(newDebt.date, periodLock, systemState.lastInventoryDate); const u = getPerformer(); if (newDebt.debtSource === 'place' || !newDebt.debtSource) { const channel = newDebt.debtChannel || 'cash'; const isRepayment = newDebt.amount < 0; const absAmount = Math.abs(newDebt.amount); if (!isRepayment) validateTransaction(ledger, absAmount, channel, newDebt.bankAccountId); const partnerName = GLOBAL_PARTNERS.find(p => p.id === newDebt.partnerId)?.name || 'شريك غير معروف'; const entry = createEntry(isRepayment ? TransactionType.PARTNER_DEPOSIT : TransactionType.PARTNER_WITHDRAWAL, absAmount, isRepayment ? 'in' : 'out', channel, `${isRepayment ? 'إيداع/سداد' : 'سحب'} شريك: ${newDebt.note}`, newDebt.bankAccountId, newDebt.id, newDebt.partnerId, newDebt.date, undefined, partnerName, u.performedById, u.performedByName); setLedger(prev => [entry, ...prev]); } setDebtsList(prev => [...prev, { ...newDebt, ...u }]); logAction('ledger', newDebt.id, 'ADD_PARTNER_DEBT', `Partner debt action: ${newDebt.amount}`); showToast('تم تسجيل الحركة بنجاح'); } catch (err: any) { showToast(err.message, 'error'); } };
    const handleDeletePartnerDebt = (debtId: string) => { try { const debt = debtsList.find(d => d.id === debtId); if (debt) { validateOperation(debt.date, periodLock, systemState.lastInventoryDate); setLedger(prev => prev.filter(e => e.entityId !== debtId)); logAction('ledger', debtId, 'DELETE_PARTNER_DEBT', `Deleted partner debt/withdrawal`); } setDebtsList(prev => prev.filter(d => d.id !== debtId)); showToast('تم حذف السجل بنجاح'); } catch (err: any) { showToast(err.message, 'error'); } };
    const handleAddCashTransfer = (newTransfer: CashTransfer) => { try { validateOperation(newTransfer.date, periodLock, systemState.lastInventoryDate); const u = getPerformer(); if (!newTransfer.targetAccountId) throw new Error('يجب تحديد الحساب البنكي المستقبل'); validateTransaction(ledger, newTransfer.amount, 'cash'); const partnerName = GLOBAL_PARTNERS.find(p => p.id === newTransfer.partnerId)?.name || 'شريك غير معروف'; const referenceId = generateId(); const outEntry = createEntry(TransactionType.LIQUIDATION_TO_APP, newTransfer.amount, 'out', 'cash', `تسييل إلى التطبيق بواسطة ${partnerName}`, undefined, newTransfer.id, newTransfer.partnerId, newTransfer.date, referenceId, partnerName, u.performedById, u.performedByName); const inEntry = createEntry(TransactionType.LIQUIDATION_TO_APP, newTransfer.amount, 'in', 'bank', `إيداع تسييل من الكاش بواسطة ${partnerName}`, newTransfer.targetAccountId, newTransfer.id, newTransfer.partnerId, newTransfer.date, referenceId, partnerName, u.performedById, u.performedByName); setLedger(prev => [inEntry, outEntry, ...prev]); setCashTransfers(prev => [...prev, { ...newTransfer, ...u }]); logAction('ledger', referenceId, 'CASH_TRANSFER', `Liquidation: ${newTransfer.amount} by ${partnerName}`); showToast('تم تسييل المبلغ بنجاح'); } catch (err: any) { showToast(err.message, 'error'); } };
    const handleManualSaving = (amount: number, channel: 'cash' | 'bank', accountId?: string, editingId?: string, goalId?: string) => { try { const date = getLocalDate(); validateOperation(date, periodLock, systemState.lastInventoryDate); const u = getPerformer(); const savingGoalName = savingGoals.find(g => g.id === goalId)?.name || 'عام'; if (editingId) { setLedger(prev => prev.map(e => { if (e.id === editingId) { return { ...e, amount, channel, accountId, performedById: u.performedById, performedByName: u.performedByName, goalId }; } return e; })); showToast('تم تعديل الإيداع بنجاح'); } else { validateTransaction(ledger, amount, channel, accountId); const entry = createEntry(TransactionType.SAVING_DEPOSIT, amount, 'out', channel, `ادخار يدوي: ${savingGoalName}`, accountId, generateId(), undefined, date, undefined, undefined, u.performedById, u.performedByName, goalId); setLedger(prev => [entry, ...prev]); logAction('savings', entry.id, 'MANUAL_DEPOSIT', `Manual saving: ${amount} from ${channel} to ${savingGoalName}`); showToast('تم تسجيل الادخار (خصم من السيولة)'); } } catch (err: any) { showToast(err.message, 'error'); } };
    const onStartNewDay = () => { 
        if (systemState.activeCycleId) { 
            showToast('يوجد دورة مفتوحة بالفعل', 'error'); 
            return; 
        } 
        const now = new Date().toISOString(); 
        const newId = generateId(); 
        const performer = getPerformer();
        
        setSystemState(prev => {
            const prevLogs = Array.isArray(prev.logs) ? prev.logs : [];
            return {
                ...prev, 
                activeCycleId: newId, 
                currentCycleStartTime: now, 
                currentDate: getLocalDate(), 
                dayStatus: 'open', 
                logs: [...prevLogs, { 
                    id: generateId(), 
                    type: 'start_cycle', 
                    dateTime: now, 
                    performedByName: performer.performedByName || 'System' 
                }] 
            };
        }); 
        
        logAction('system', 'cycle', 'start_cycle', 'تم فتح دورة جديدة'); 
        showToast('تم فتح الدورة / اليوم بنجاح'); 
    };
    const onCloseDayAction = () => { if (!systemState.activeCycleId) { showToast('لا يوجد دورة يومية مفتوحة للإغلاق', 'error'); return; } if (sessions.length > 0) { showToast('تنبيه: يوجد جلسات مفتوحة!', 'error'); return; } try { const preview = calcEndDayPreviewFromLedger(ledger, systemState.currentCycleStartTime!, bankAccounts, pricingConfig); setEndDayData(preview); setModals(m => ({ ...m, endDay: true })); } catch (e) { showToast('حدث خطأ أثناء تحضير إغلاق اليوم', 'error'); } };
    const onInventoryAction = () => { try { const { entries: savingsEntries, updatedPlans } = processAutoSavings(savingPlans, ledger, getLocalDate()); setPendingAutoSavings({ entries: savingsEntries, updatedPlans }); const end = systemState.currentDate; let start = systemState.lastInventoryDate || (end.slice(0, 7) + '-01'); setInventoryRange({ start, end }); const effectiveLedger = [...ledger]; const preview = calcLedgerInventory(effectiveLedger, records, start, end, expenses, pricingConfig, 0, systemState.lastInventoryAt, savingPlans, placeLoans); if (preview) { setInventoryPreview(preview); setCurrentMeterReading((pricingConfig.lastMeterReading || 0).toString()); setModals(m => ({ ...m, inventory: true })); } else { showToast('حدث خطأ في حساب الجرد', 'error'); } } catch (error: any) { showToast(error.message || 'حدث خطأ غير متوقع', 'error'); } };
    
    const handleArchiveInventory = () => { if (!inventoryPreview) return; const u = getPerformer(); let updatedPlans = [...savingPlans]; let newMeterReading = pricingConfig.lastMeterReading; updatedPlans = updatedPlans.map(p => { if (p.category === 'expense' && p.isActive) { if (p.lastAppliedAt < inventoryRange.end) { return { ...p, lastAppliedAt: inventoryRange.end }; } } return p; }); if (inventoryPreview.electricityCost > 0) { newMeterReading = inventoryPreview.endMeterReading; } setSavingPlans(updatedPlans); setPricingConfig(prev => ({ ...prev, lastMeterReading: newMeterReading })); logAction('system', 'inventory', 'archive_only', `أرشفة الجرد للفترة ${inventoryRange.start} - ${inventoryRange.end}. تم حساب التكاليف نظرياً ولم يتم خصمها من الصندوق.`); showToast('تم حفظ التقرير وتحديث العدادات. لم يتم خصم أي مبالغ من الصندوق.'); const snap: InventorySnapshot = { id: generateId(), type: 'manual', archiveId: `INV-${new Date().getFullYear()}-${inventorySnapshots.length + 1}`, ...inventoryPreview, performedById: u.performedById, electricityPaymentChannel: undefined, electricityBankAccountId: undefined }; setInventorySnapshots(prev => [...prev, snap]); const lock: PeriodLock = { lockedUntil: inventoryRange.end, lockId: generateId(), createdAt: new Date().toISOString(), notes: 'Auto-locked after inventory archive', performedById: u.performedById }; setPeriodLock(lock); const nowIso = new Date().toISOString(); setSystemState(prev => { const newState: SystemState = { ...prev, lastInventoryDate: inventoryRange.end, lastInventoryAt: nowIso, activeCycleId: null, dayStatus: 'closed' }; try { excelSet('cw_system_state', JSON.stringify(newState)); } catch (e) { } return newState; }); setPendingAutoSavings(null); setModals(m => ({ ...m, inventory: false, inventoryConfirm: false })); };

    const handleEditSession = (session: Session) => {
        const timeStr = new Date(session.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const cust = customers.find(c => c.phone === session.customerPhone);
        
        setNewSessionData({
            name: session.customerName,
            phone: session.customerPhone || '',
            time: timeStr,
            device: session.deviceStatus,
            notes: session.notes || '',
            isVIP: cust?.isVIP || false
        });
        setEditingSessionId(session.id);
        setModals(prev => ({ ...prev, addSession: true }));
    };

    const handleStartSession = () => { 
        if (!newSessionData.name.trim()) { 
            showToast('الاسم مطلوب', 'error'); 
            return; 
        } 

        // --- EDIT MODE ---
        if (editingSessionId) {
            // Check duplicates excluding self
            const dup = sessions.find(s => s.customerPhone === newSessionData.phone && s.id !== editingSessionId);
            if (dup) {
                showToast('هذا الزبون لديه جلسة مفتوحة بالفعل.', 'error');
                return;
            }

            setSessions(prev => prev.map(s => {
                if (s.id !== editingSessionId) return s;
                // Preserve the date part, update time part
                const datePart = s.startTime.split('T')[0];
                const newStartIso = mergeDateAndTime(datePart, newSessionData.time);
                
                return {
                    ...s,
                    customerName: newSessionData.name,
                    customerPhone: newSessionData.phone,
                    startTime: newStartIso,
                    deviceStatus: newSessionData.device,
                    notes: newSessionData.notes
                };
            }));

            // Update Customer if exists or create VIP if requested
            const existingCustomer = customers.find(c => c.phone === newSessionData.phone);
            if (existingCustomer) {
                setCustomers(prev => prev.map(c => c.id === existingCustomer.id ? { ...c, name: newSessionData.name, isVIP: newSessionData.isVIP } : c));
            } else if (newSessionData.isVIP) {
                setCustomers(prev => [...prev, { id: generateId(), name: newSessionData.name, phone: newSessionData.phone, isVIP: true, creditBalance: 0, debtBalance: 0, createdAt: new Date().toISOString() }]);
            }

            logAction('session', editingSessionId, 'edit_session', `تعديل بيانات الجلسة: ${newSessionData.name}`);
            setModals(prev => ({ ...prev, addSession: false }));
            setEditingSessionId(null);
            setNewSessionData({ name: '', phone: '', time: getCurrentTimeOnly(), device: 'mobile', notes: '', isVIP: false });
            showToast('تم حفظ التعديلات');
            return;
        }

        // --- CREATE MODE ---
        if (!newSessionData.phone.trim()) { showToast('رقم الجوال مطلوب', 'error'); return; }
        if (!systemState.activeCycleId) { showToast('يجب فتح الدورة اليومية أولاً', 'error'); return; } 
        if (sessions.some(s => s.customerPhone === newSessionData.phone)) { showToast('هذا الزبون لديه جلسة مفتوحة بالفعل.', 'error'); return; } 
        
        const startTimeIso = mergeDateAndTime(systemState.currentDate, newSessionData.time); 
        const diffMs = new Date().getTime() - new Date(startTimeIso).getTime(); 
        const diffHours = diffMs / (1000 * 60 * 60); 
       if (diffHours > 15) { showToast('خطأ: تاريخ الدورة المفتوحة قديم (أمس). يرجى إغلاق اليوم وبدء يوم جديد لتفادي أخطاء الحساب.', 'error'); return; } 
        
        const sessionId = generateId(); 
        const u = getPerformer(); 
        const newSession: Session = { id: sessionId, customerName: newSessionData.name, customerPhone: newSessionData.phone, startTime: startTimeIso, deviceStatus: newSessionData.device, notes: newSessionData.notes, orders: [], events: [], startedById: u.performedById }; 
        
        const existingCustomer = customers.find(c => c.phone === newSessionData.phone); 
        if (newSessionData.isVIP || existingCustomer) { const payload = { lastVisit: startTimeIso, isVIP: newSessionData.isVIP || existingCustomer?.isVIP }; if (existingCustomer) setCustomers(customers.map(c => c.id === existingCustomer.id ? { ...c, ...payload } : c)); else setCustomers([...customers, { id: generateId(), name: newSessionData.name, phone: newSessionData.phone, isVIP: true, creditBalance: 0, debtBalance: 0, createdAt: new Date().toISOString(), ...payload }]); } 
        setSessions(prev => [newSession, ...prev]); 
        logAction('session', sessionId, 'start_session', `بدء جلسة ${newSession.deviceStatus === 'mobile' ? 'جوال' : 'لابتوب'}`); 
        setNewSessionData({ name: '', phone: '', time: getCurrentTimeOnly(), device: 'mobile', notes: '', isVIP: false }); 
        setModals(m => ({ ...m, addSession: false })); 
        showToast('تم بدء الجلسة'); 
    };

    const handleDeviceChange = (sessionId: string, newDevice: DeviceStatus) => { const u = getPerformer(); setSessions(prev => prev.map(s => { if (s.id !== sessionId || s.deviceStatus === newDevice) return s; const now = new Date().toISOString(); const newEvent = { id: generateId(), type: 'device_change' as const, timestamp: now, fromDevice: s.deviceStatus, toDevice: newDevice, performedById: u.performedById }; logAction('session', s.id, 'device_change', `تغيير الجهاز`); return { ...s, deviceStatus: newDevice, events: [...(s.events || []), newEvent] }; })); showToast(`تم تغيير الجهاز`); };
    const handleUndoEvent = (sessionId: string) => { setSessions(prev => prev.map(s => { if (s.id !== sessionId || !s.events || s.events.length === 0) return s; const lastEvent = s.events[s.events.length - 1]; return { ...s, deviceStatus: lastEvent.fromDevice, events: s.events.slice(0, -1) }; })); logAction('session', sessionId, 'undo_event', 'تراجع عن تغيير الجهاز'); showToast('تم التراجع عن آخر تغيير'); };
    
    // Updated handleCompleteCheckout to handle Multiple Sessions with Primary Payer Logic
    const handleCompleteCheckout = () => { 
        if (!checkoutFinancials || checkoutFinancials.individualResults.length === 0) return; 
        if (!systemState.activeCycleId) { showToast('لا يمكن إنهاء الجلسة. النظام مغلق.', 'error'); return; } 
        if (checkoutData.sessions.length > 1 && !checkoutData.primarySessionId) { showToast('يجب تحديد الزبون المسؤول عن الدفع (المميز).', 'error'); return; }

        const endTimeIso = mergeDateAndTime(systemState.currentDate, checkoutData.time); 
        const nowIso = new Date().toISOString(); 
        const dateKey = systemState.currentDate; 
        const u = getPerformer(); 
        
        try { validateOperation(dateKey, periodLock, systemState.lastInventoryDate); } catch (err: any) { showToast(err.message, 'error'); return; } 
        
        // 1. Prepare Payment Info
        const totalPaidCash = parseFloat(checkoutData.cash) || 0;
        const totalPaidBank = parseFloat(checkoutData.bank) || 0;
        const totalPaid = totalPaidCash + totalPaidBank;
        const grandTotalDue = checkoutFinancials.grandTotalDue;

        // 2. Identify Primary Payer Session
        const primarySessionId = checkoutData.primarySessionId || checkoutData.sessions[0].id;
        const primarySession = checkoutData.sessions.find(s => s.id === primarySessionId)!;
        
        // 3. Process Customers (Only Primary Payer state is affected by balance change)
        const updatedCustomers = [...customers];
        
        const getOrCreateCustomer = (session: Session) => {
            const idx = updatedCustomers.findIndex(c => c.phone === session.customerPhone);
            if (idx >= 0) return updatedCustomers[idx];
            return { id: generateId(), name: session.customerName, phone: session.customerPhone || 'unknown', isVIP: false, creditBalance: 0, debtBalance: 0, createdAt: '' };
        };

        const primaryCustomer = getOrCreateCustomer(primarySession);
        
        // Calculate Impact on Primary Customer
        // Logic: Primary Customer is responsible for "Grand Total Due". They paid "Total Paid".
        // Their previous balance is considered.
        const calc = calculateCustomerTransaction(grandTotalDue, totalPaid, primaryCustomer);
        
        // Update Primary Customer in List
        const primaryUpdatePayload = { 
            creditBalance: calc.finalCredit, 
            debtBalance: calc.finalDebt, 
            isVIP: primaryCustomer.isVIP || calc.finalCredit > 0 || calc.finalDebt > 0, 
            lastVisit: nowIso 
        };
        
        const primaryIdx = updatedCustomers.findIndex(c => c.phone === primarySession.customerPhone);
        if (primaryIdx >= 0) {
            updatedCustomers[primaryIdx] = { ...updatedCustomers[primaryIdx], ...primaryUpdatePayload };
        } else if (primarySession.customerPhone) {
            updatedCustomers.push({ 
                id: generateId(), 
                name: primarySession.customerName, 
                phone: primarySession.customerPhone, 
                isVIP: calc.finalCredit > 0 || calc.finalDebt > 0, 
                createdAt: nowIso, 
                notes: '', 
                ...primaryUpdatePayload 
            });
        }

        // 4. Create Ledger Entries (Consolidated for the Group)
        const newLedgerEntries: LedgerEntry[] = [];
        const groupNote = checkoutData.sessions.length > 1 
            ? `دفعة جماعية (${checkoutData.sessions.length} جلسات) بواسطة ${primarySession.customerName}`
            : `إيراد: ${primarySession.customerName}`;

        if (totalPaidCash > 0) {
            newLedgerEntries.push(createEntry(TransactionType.INCOME_SESSION, totalPaidCash, 'in', 'cash', groupNote, undefined, primarySession.id, undefined, dateKey, undefined, undefined, u.performedById, u.performedByName));
        }
        if (totalPaidBank > 0) {
            const entry = createEntry(TransactionType.INCOME_SESSION, totalPaidBank, 'in', 'bank', groupNote, checkoutData.bankAccountId, primarySession.id, undefined, dateKey, undefined, undefined, u.performedById, u.performedByName);
            entry.senderName = checkoutData.senderAccountName;
            entry.senderPhone = checkoutData.senderPhone;
            entry.transferStatus = 'rejected';
            newLedgerEntries.push(entry);
        }
        if (calc.createdDebt > 0) {
            newLedgerEntries.push(createEntry(TransactionType.DEBT_CREATE, calc.createdDebt, 'in', 'receivable', `دين (جماعي): ${primarySession.customerName}`, undefined, primarySession.id, undefined, dateKey, undefined, undefined, u.performedById, u.performedByName));
        }

        // 5. Create Records (History)
        const newRecords: Record[] = [];
        const processedSessionIds: string[] = [];

        checkoutFinancials.individualResults.forEach(({ session, financials }) => {
            processedSessionIds.push(session.id);
            const isPrimary = session.id === primarySession.id;
            
            // For Primary: Attach the transaction details.
            // For Others: Mark as paid via group.
            const transactions: Transaction[] = [];
            
            if (isPrimary) {
                if (totalPaidCash > 0) transactions.push({ id: generateId(), date: nowIso, amount: totalPaidCash, type: 'cash' });
                if (totalPaidBank > 0) transactions.push({ id: generateId(), date: nowIso, amount: totalPaidBank, type: 'bank', bankAccountId: checkoutData.bankAccountId, senderPhone: checkoutData.senderPhone, senderAccountName: checkoutData.senderAccountName });
                if (calc.appliedCredit > 0) transactions.push({ id: generateId(), date: nowIso, amount: calc.appliedCredit, type: 'credit_usage', note: 'خصم من الرصيد السابق' });
            } else {
                // Conceptually paid by primary
                transactions.push({ id: generateId(), date: nowIso, amount: financials.totalInvoice || 0, type: 'credit_usage', note: `مدفوع بواسطة ${primarySession.customerName}` });
            }

            // Determine Status for Record
            // Non-primaries are cleared (debt = 0).
            // Primary carries the remaining debt/credit outcome of the GROUP.
            // *Correction*: Record `remainingDebt` usually reflects the invoice balance. 
            // If primary carries all debt, then primary record `remainingDebt` = `calc.finalDebt` (simplified)? 
            // Or strictly Invoice - Paid?
            // To ensure `RecordsList` logic works (debt = red), we set:
            // Others: remainingDebt = 0.
            // Primary: remainingDebt = calc.createdDebt (The NEW debt from this transaction).
            
            let paidTotal = 0;
            let recordRemainingDebt = 0;
            let cashPaidRec = 0;
            let bankPaidRec = 0;

            if (isPrimary) {
                paidTotal = totalPaid + calc.appliedCredit;
                // If total paid < grand total, the difference is debt. 
                // We assign the ENTIRE group debt to this record for tracking? 
                // Or just the portion relevant to this invoice? 
                // The requirement is "register debt on VIP". 
                // So we show the debt on this record.
                // However, strictly `totalInvoice` is only the primary's share.
                // If we set `remainingDebt` > `totalInvoice`, it looks weird but accurate for "Group Debt Carrier".
                // Let's set remainingDebt = calc.createdDebt (The net new debt).
                recordRemainingDebt = calc.createdDebt; 
                cashPaidRec = totalPaidCash;
                bankPaidRec = totalPaidBank;
            } else {
                paidTotal = financials.totalInvoice || 0;
                recordRemainingDebt = 0;
            }

            const isPaid = recordRemainingDebt < 0.5;

            const newRecord: Record = { 
                id: session.id, 
                customerName: session.customerName, 
                customerPhone: session.customerPhone, 
                startTime: session.startTime, 
                endTime: endTimeIso, 
                durationMinutes: financials.durationMinutes!, 
                sessionInvoice: financials.sessionInvoice!, 
                drinksInvoice: financials.drinksInvoice!, 
                internetCardsInvoice: financials.internetCardsInvoice!, 
                totalInvoice: financials.totalInvoice || 0, 
                totalDue: financials.totalInvoice || 0, 
                discountApplied: financials.discountApplied, 
                placeCost: financials.placeCost!, 
                drinksCost: financials.drinksCost!, 
                internetCardsCost: financials.internetCardsCost!, 
                grossProfit: financials.grossProfit!, 
                devPercentSnapshot: financials.devPercentSnapshot!, 
                devCut: financials.devCut!, 
                netProfit: financials.netProfit!, 
                paymentStatus: isPaid ? 'paid' : 'customer_debt', 
                isPaid: isPaid, 
                cashPaid: cashPaidRec, 
                bankPaid: bankPaidRec, 
                creditApplied: isPrimary ? calc.appliedCredit : 0, 
                createdDebt: isPrimary ? calc.createdDebt : 0, 
                createdCredit: isPrimary ? calc.createdCredit : 0, 
                settledDebt: isPrimary ? calc.settledDebt : 0, 
                bankAccountId: isPrimary && totalPaidBank > 0 ? checkoutData.bankAccountId : undefined, 
                bankAccountNameSnapshot: isPrimary && totalPaidBank > 0 ? bankAccounts.find(b => b.id === checkoutData.bankAccountId)?.name : undefined, 
                senderPhone: isPrimary && totalPaidBank > 0 ? checkoutData.senderPhone : undefined, 
                senderAccountName: isPrimary && totalPaidBank > 0 ? checkoutData.senderAccountName : undefined, 
                transactions: transactions, 
                paidTotal: paidTotal, 
                remainingDebt: recordRemainingDebt, 
                lastPaymentDate: nowIso, 
                excuse: checkoutData.excuse, 
                timestamp: Date.now(), 
                orders: session.orders, 
                deviceStatus: session.deviceStatus, 
                hourlyRateSnapshot: financials.hourlyRateSnapshot!, 
                placeCostRateSnapshot: financials.placeCostRateSnapshot!, 
                events: session.events, 
                segmentsSnapshot: financials.segmentsSnapshot, 
                performedById: u.performedById, 
                performedByName: u.performedByName 
            };
            newRecords.push(newRecord);
            
            logAction('session', session.id, 'checkout', isPrimary ? `إغلاق (مميز): ${groupNote}` : `إغلاق (تابع): مدفوع ضمن مجموعة`);
        });

        setLedger(prev => [...newLedgerEntries, ...prev]);
        setCustomers(updatedCustomers);
        setRecords(prev => [...newRecords, ...prev]);
        setSessions(prev => prev.filter(s => !processedSessionIds.includes(s.id))); 
        
        setModals({ ...modals, checkout: false }); 
        showToast(`تم إغلاق ${newRecords.length} جلسات بنجاح.`); 
    };

    const handleRepayDebt = (recordId: string, amount: number, type: 'cash' | 'bank' | 'transfer', details?: any) => { 
        try { 
            if (amount <= 0) { showToast('المبلغ يجب أن يكون أكبر من صفر', 'error'); return; } 
            validateOperation(getLocalDate(), periodLock, systemState.lastInventoryDate); 
            if (!systemState.activeCycleId) { showToast('النظام مغلق', 'error'); return; } 
            
            const u = getPerformer(); 
            const record = records.find(r => r.id === recordId); 
            if (!record) return; 
            const customer = customers.find(c => c.phone === record.customerPhone); 
            if (!customer) return; 
            
            // --- THIRD PARTY PAYMENT LOGIC ---
            if (type === 'transfer' && details.payerId) {
                const payer = customers.find(c => c.id === details.payerId);
                if (!payer) { showToast('الزبون الدافع غير موجود', 'error'); return; }

                // 1. Update Payer Balance (Deduct Credit or Increase Debt)
                let payerCredit = payer.creditBalance || 0;
                let payerDebt = payer.debtBalance || 0;
                
                // Consume Credit first
                const creditUsed = Math.min(payerCredit, amount);
                payerCredit -= creditUsed;
                const remainingToPay = amount - creditUsed;
                
                // Add remainder to Debt
                payerDebt += remainingToPay;
                
                const updatedPayer = { ...payer, creditBalance: payerCredit, debtBalance: payerDebt, lastVisit: new Date().toISOString() };
                
                // 2. Ledger Entries
                // Entry 1: Debt Paid (Received)
                const entryPaid = createEntry(
                    TransactionType.DEBT_PAYMENT, 
                    amount, 
                    'in', 
                    'receivable', 
                    `سداد دين عن طريق ${payer.name}`, 
                    undefined, recordId, undefined, getLocalDate(), undefined, undefined, u.performedById, u.performedByName
                );
                
                // Entry 2: Debt Created (Liability Shift)
                const entryCharge = createEntry(
                    TransactionType.DEBT_CREATE,
                    amount,
                    'in',
                    'receivable',
                    `تحويل دين من ${record.customerName}`,
                    undefined, recordId, undefined, getLocalDate(), undefined, undefined, u.performedById, u.performedByName
                );
                
                setLedger(prev => [entryCharge, entryPaid, ...prev]);
                
                // 3. Update Customers & Records
                setCustomers(curr => curr.map(c => {
                    if (c.id === payer.id) return updatedPayer;
                    if (c.id === customer.id) {
                        return { ...c, debtBalance: Math.max(0, (c.debtBalance || 0) - amount) };
                    }
                    return c;
                }));

                const txId = generateId();
                setRecords(prev => prev.map(r => {
                    if (r.id !== recordId) return r;
                    const newTx: Transaction = { id: txId, date: new Date().toISOString(), amount, type: 'credit_usage', note: `سداد بواسطة ${payer.name}` };
                    
                    // Recalculate remaining debt logic same as standard repayment
                    const toNum = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
                    const prevPaidTotal = toNum(r.paidTotal);
                    const prevRemainingDebt = (typeof r.remainingDebt === 'number' && Number.isFinite(r.remainingDebt)) ? r.remainingDebt : Math.max(0, toNum(r.totalInvoice) - prevPaidTotal);
                    const newPaidTotal = prevPaidTotal + amount;
                    const newRemainingDebt = Math.max(0, prevRemainingDebt - amount);
                    const isNowPaid = newRemainingDebt < 0.5;
                    
                    return { 
                        ...r, 
                        transactions: [...(r.transactions || []), newTx], 
                        paidTotal: newPaidTotal, 
                        remainingDebt: newRemainingDebt, 
                        isPaid: isNowPaid, 
                        paymentStatus: isNowPaid ? 'paid' : 'customer_debt', 
                        lastPaymentDate: new Date().toISOString(),
                        creditApplied: toNum(r.creditApplied) + amount 
                    };
                }));

                logAction('record', recordId, 'DEBT_TRANSFER', `تم تحويل الدين بقيمة ${amount} إلى ${payer.name}`);
                showToast(`تم تحويل الدين بنجاح إلى ${payer.name}`, 'success');
                return;
            }
            // --- END THIRD PARTY LOGIC ---

            const toNum = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : 0); 
            const customerRemaining = toNum(customer.debtBalance); 
            const recordRemaining = (typeof record.remainingDebt === 'number' && Number.isFinite(record.remainingDebt)) ? record.remainingDebt : Math.max(0, toNum(record.totalInvoice) - toNum(record.paidTotal)); 
            const effectiveRemaining = Math.max(customerRemaining, recordRemaining); 
            const applied = Math.min(amount, effectiveRemaining); 
            const extra = Math.max(amount - applied, 0); 
            const newEntries: LedgerEntry[] = []; 
            const txId = generateId(); 
            
            if (applied > 0) { 
                const entry = createEntry(TransactionType.DEBT_PAYMENT, applied, 'in', type as any, 'DebtPayment', type === 'bank' ? details.bankAccountId : undefined, recordId, undefined, getLocalDate(), txId, undefined, u.performedById, u.performedByName); 
                if (type === 'bank') { entry.senderName = details.senderAccountName; entry.senderPhone = details.senderPhone; entry.transferStatus = 'rejected'; } 
                newEntries.push(entry); 
            } 
            if (extra > 0) { 
                const entry = createEntry(TransactionType.INCOME_SESSION, extra, 'in', type as any, 'CreditTopUp', type === 'bank' ? details.bankAccountId : undefined, recordId, undefined, getLocalDate(), txId, undefined, u.performedById, u.performedByName); 
                if (type === 'bank') { entry.senderName = details.senderAccountName; entry.senderPhone = details.senderPhone; entry.transferStatus = 'rejected'; } 
                newEntries.push(entry); 
            } 
            
            setLedger(prev => [...newEntries, ...prev]); 
            setCustomers(curr => curr.map(c => c.id === customer.id ? { ...c, debtBalance: Math.max(0, customerRemaining - Math.min(applied, customerRemaining)), creditBalance: toNum(c.creditBalance) + extra } : c)); 
            setRecords(prev => prev.map(r => { if (r.id !== recordId) return r; const newTx: Transaction = { id: txId, date: new Date().toISOString(), amount, type: type as any, ...details, note: 'سداد دين' }; const prevPaidTotal = toNum(r.paidTotal); const prevRemainingDebt = (typeof r.remainingDebt === 'number' && Number.isFinite(r.remainingDebt)) ? r.remainingDebt : Math.max(0, toNum(r.totalInvoice) - prevPaidTotal); const newPaidTotal = prevPaidTotal + amount; const newRemainingDebt = Math.max(0, prevRemainingDebt - amount); const isNowPaid = newRemainingDebt < 0.5; return { ...r, transactions: [...(r.transactions || []), newTx], paidTotal: newPaidTotal, remainingDebt: newRemainingDebt, isPaid: isNowPaid, paymentStatus: isNowPaid ? 'paid' : 'customer_debt', lastPaymentDate: new Date().toISOString(), cashPaid: type === 'cash' ? toNum(r.cashPaid) + amount : toNum(r.cashPaid), bankPaid: type === 'bank' ? toNum(r.bankPaid) + amount : toNum(r.bankPaid) }; })); logAction('record', recordId, 'DEBT_PAYMENT', `سداد دين بقيمة ${amount} (${type})`); if (extra > 0) { showToast(`تم سداد الدين بالكامل، وتم إضافة ${extra.toFixed(2)} ₪ كرصيد للزبون.`, 'success'); } else { showToast('تم تسجيل العملية بنجاح', 'success'); } 
        } catch (err: any) { showToast(err.message, 'error'); } 
    };
    const handleRevertTransaction = (recordId: string, transactionId: string) => { const record = records.find(r => r.id === recordId); if (!record || !record.transactions) return; const tx = record.transactions.find(t => t.id === transactionId); if (!tx) return; try { validateOperation(tx.date.split('T')[0], periodLock, systemState.lastInventoryDate); const u = getPerformer(); const ledgerEntries = ledger.filter(e => e.referenceId === transactionId || (e.entityId === recordId && e.amount === tx.amount && e.timestamp.startsWith(tx.date.slice(0, 16)))); const correctionEntries: LedgerEntry[] = []; if (ledgerEntries.length > 0) { ledgerEntries.forEach(entry => { correctionEntries.push(createEntry(entry.type, entry.amount, entry.direction === 'in' ? 'out' : 'in', entry.channel, `تصحيح: تراجع عن عملية ${entry.description}`, entry.accountId, recordId, undefined, getLocalDate(), undefined, undefined, u.performedById, u.performedByName)); }); } else { if (tx.type === 'cash' || tx.type === 'bank') { correctionEntries.push(createEntry(TransactionType.EXPENSE_OPERATIONAL, tx.amount, 'out', tx.type, `تراجع عن سداد فاتورة ${record.customerName}`, tx.bankAccountId, recordId, undefined, getLocalDate(), undefined, undefined, u.performedById, u.performedByName)); } } setLedger(prev => [...correctionEntries, ...prev]); const customer = customers.find(c => c.phone === record.customerPhone); if (customer) { const toNum = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : 0); if (tx.type === 'credit_usage') { setCustomers(curr => curr.map(c => c.id === customer.id ? { ...c, creditBalance: toNum(c.creditBalance) + tx.amount } : c)); } else { setCustomers(curr => curr.map(c => c.id === customer.id ? { ...c, debtBalance: toNum(c.debtBalance) + tx.amount } : c)); } } setRecords(prev => prev.map(r => { if (r.id !== recordId) return r; const toNum = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : 0); const prevPaidTotal = toNum(r.paidTotal); const prevRemainingDebt = (typeof r.remainingDebt === 'number' && Number.isFinite(r.remainingDebt)) ? r.remainingDebt : Math.max(0, toNum(r.totalInvoice) - prevPaidTotal); const newPaidTotal = prevPaidTotal - tx.amount; const newRemainingDebt = prevRemainingDebt + tx.amount; const updatedTx = r.transactions!.filter(t => t.id !== transactionId); let newCashPaid = toNum(r.cashPaid); let newBankPaid = toNum(r.bankPaid); if (tx.type === 'cash') newCashPaid -= tx.amount; if (tx.type === 'bank') newBankPaid -= tx.amount; const isNowPaid = newRemainingDebt < 0.5; return { ...r, transactions: updatedTx, paidTotal: newPaidTotal, remainingDebt: newRemainingDebt, isPaid: isNowPaid, paymentStatus: isNowPaid ? 'paid' : 'customer_debt', cashPaid: newCashPaid, bankPaid: newBankPaid }; })); logAction('record', recordId, 'REVERT_TRANSACTION', `تراجع عن عملية سداد بقيمة ${tx.amount}`); showToast('تم التراجع عن العملية بنجاح'); } catch (e: any) { showToast(e.message, 'error'); } };
    const handleConfirmEndDay = () => { if (!endDayData || !systemState.activeCycleId) return; const u = getPerformer(); const cycle: DayCycle = { id: systemState.activeCycleId, dateKey: systemState.currentDate, monthKey: systemState.currentMonth, startTime: systemState.currentCycleStartTime!, endTime: new Date().toISOString(), ...endDayData, notes: endDayNotes, createdAt: Date.now(), closedById: u.performedById }; setDayCycles(prev => [...prev, cycle]); setSystemState(prev => ({ ...prev, activeCycleId: null, currentCycleStartTime: null, dayStatus: 'closed', logs: [...prev.logs, { id: generateId(), type: 'close_cycle', dateTime: new Date().toISOString(), performedByName: u.performedByName }] })); logAction('system', systemState.activeCycleId, 'close_cycle', 'إغلاق الدورة اليومية'); setModals(m => ({ ...m, endDay: true })); showToast('تم إغلاق الدورة. يمكنك بدء دورة جديدة الآن.'); };
    const handleSaveOrder = () => { if (!orderData.target) return; const targetDate = 'durationMinutes' in orderData.target ? (orderData.target as Record).endTime.split('T')[0] : systemState.currentDate; try { validateOperation(targetDate, periodLock, systemState.lastInventoryDate); } catch (e: any) { showToast(e.message, 'error'); return; } const qty = parseInt(orderData.qty) || 1; let price = 0, cost = 0, name = ''; if (orderData.type === 'drink') { const d = drinks.find(x => x.id === orderData.itemId); if (!d) { showToast('المشروب غير موجود', 'error'); return; } if (d.components && d.components.length > 0) { const missingItems: string[] = []; for (const comp of d.components) { const invItem = inventoryItems.find(i => i.id === comp.itemId); const needed = comp.qty * qty; if (!invItem || invItem.qty < needed) { missingItems.push(invItem?.name || 'مادة غير معروفة'); } } if (missingItems.length > 0) { showToast(`لا يمكن إضافة الطلب! نقص في: ${missingItems.join('، ')}`, 'error'); return; } } name = d.name; if (orderData.size === 'small') { price = d.smallPrice || 0; } else { price = d.largePrice || 0; } cost = calculateDrinkCost(d, inventoryItems); } else if (orderData.type === 'internet_card') { const c = internetCards.find(x => x.id === orderData.itemId); if (!c) { showToast('الصنف غير موجود', 'error'); return; } if (c.inventoryItemId) { const invItem = inventoryItems.find(i => i.id === c.inventoryItemId); const deductionAmount = c.deductionAmount || 1; const needed = qty * deductionAmount; if (!invItem || invItem.qty < needed) { showToast(`لا يمكن إضافة الطلب! نقص في المخزون لـ: ${invItem?.name || 'البطاقة'}`, 'error'); return; } } name = c.name; price = c.price; cost = c.cost; } const newOrder: Order = { id: orderData.orderIdToEdit || generateId(), type: orderData.type, itemId: orderData.itemId, itemName: name, size: orderData.type === 'drink' ? orderData.size : undefined, priceAtOrder: price, costAtOrder: cost, quantity: qty, timestamp: mergeDateAndTime(systemState.currentDate, orderData.time) }; const now = new Date().toISOString(); const isEdit = !!orderData.orderIdToEdit; let oldQty = 0; if (isEdit) { const targetOrders = ('durationMinutes' in orderData.target!) ? (orderData.target as Record).orders : (orderData.target as Session).orders; const existing = targetOrders.find(o => o.id === orderData.orderIdToEdit); if (existing) oldQty = existing.quantity; } const deltaQty = qty - oldQty; if (orderData.type === 'drink') { const d = drinks.find(x => x.id === orderData.itemId); if (d && d.components && d.components.length > 0 && deltaQty !== 0) { setInventoryItems(prevItems => { return prevItems.map(invItem => { const component = d.components?.find(c => c.itemId === invItem.id); if (component) { const amountChange = component.qty * deltaQty; const newQty = (invItem.qty || 0) - amountChange; const movement: InventoryMovement = { id: generateId(), date: now, qty: Math.abs(amountChange), type: 'out' as const, notes: `${isEdit ? 'تعديل طلب' : 'طلب مشروب'}: ${d.name} (فاتورة: ${orderData.target?.customerName})` }; logAction('inventory', invItem.id, amountChange > 0 ? 'DEDUCTION' : 'RESTORE', `${amountChange > 0 ? 'خصم' : 'استرجاع'} آلي: ${Math.abs(amountChange)} بسبب ${isEdit ? 'تعديل' : 'طلب'} ${d.name}`); return { ...invItem, qty: newQty, movements: [...(invItem.movements || []), movement] }; } return invItem; }); }); } } else if (orderData.type === 'internet_card') { const c = internetCards.find(x => x.id === orderData.itemId); if (c && c.inventoryItemId && deltaQty !== 0) { setInventoryItems(prevItems => { return prevItems.map(invItem => { if (invItem.id === c.inventoryItemId) { const deductionPerUnit = c.deductionAmount || 1; const amountChange = deltaQty * deductionPerUnit; const newQty = (invItem.qty || 0) - amountChange; const movement: InventoryMovement = { id: generateId(), date: now, qty: Math.abs(amountChange), type: 'out' as const, notes: `${isEdit ? 'تعديل بيع بطاقة' : 'بيع بطاقة'}: ${c.name} (فاتورة: ${orderData.target?.customerName})` }; logAction('inventory', invItem.id, amountChange > 0 ? 'DEDUCTION' : 'RESTORE', `${amountChange > 0 ? 'خصم' : 'استرجاع'} آلي: ${Math.abs(amountChange)} بسبب ${isEdit ? 'تعديل' : 'بيع'} بطاقة ${c.name}`); return { ...invItem, qty: newQty, movements: [...(invItem.movements || []), movement] }; } return invItem; }); }); } } logAction('session', orderData.target.id, orderData.orderIdToEdit ? 'edit_order' : 'add_order', `${orderData.orderIdToEdit ? 'تعديل' : 'إضافة'} طلب: ${name} (${qty})`); if ('durationMinutes' in orderData.target) { setRecords(prev => prev.map(r => { if (r.id !== orderData.target!.id) return r; const ords = orderData.orderIdToEdit ? r.orders.map(o => o.id === orderData.orderIdToEdit ? newOrder : o) : [...r.orders, newOrder]; const fins = calcRecordFinancials(r as any, r.endTime, pricingConfig, ords, r.discountApplied); const newTotal = fins.totalInvoice || 0; const paid = r.paidTotal || 0; const rem = Math.max(0, newTotal - paid); const isNowPaid = rem < 0.5; return { ...r, ...fins, orders: ords, totalInvoice: newTotal, remainingDebt: rem, isPaid: isNowPaid, paymentStatus: isNowPaid ? 'paid' : 'customer_debt' }; })); } else { setSessions(prev => prev.map(s => s.id === orderData.target!.id ? { ...s, orders: orderData.orderIdToEdit ? s.orders.map(o => o.id === orderData.orderIdToEdit ? newOrder : o) : [...s.orders, newOrder] } : s)); } setModals(m => ({ ...m, addOrder: false })); showToast('تم حفظ الطلب وخصم من المخزون بنجاح'); };
    const handleEditOrder = (s: Session | Record, o: Order) => { setOrderData({ target: s, orderIdToEdit: o.id, type: o.type, itemId: o.itemId, size: o.size || 'small', qty: o.quantity.toString(), time: new Date(o.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }); setModals(m => ({ ...m, addOrder: true })); };
    const handleDeleteOrder = (target: any, orderId: string) => { const targetDate = 'durationMinutes' in target ? (target as Record).endTime.split('T')[0] : systemState.currentDate; try { validateOperation(targetDate, periodLock, systemState.lastInventoryDate); } catch (e: any) { showToast(e.message, 'error'); return; } logAction('session', target.id, 'delete_order', `حذف طلب ${orderId}`); const now = new Date().toISOString(); const targetOrders = ('durationMinutes' in target) ? (target as Record).orders : (target as Session).orders; const orderToDelete = targetOrders.find((o: Order) => o.id === orderId); if (orderToDelete) { if (orderToDelete.type === 'drink') { const d = drinks.find(x => x.id === orderToDelete.itemId); if (d && d.components && d.components.length > 0) { setInventoryItems(prevItems => prevItems.map(invItem => { const comp = d.components?.find(c => c.itemId === invItem.id); if (!comp) return invItem; const restoreQty = comp.qty * orderToDelete.quantity; const newQty = (invItem.qty || 0) + restoreQty; const movement = { id: generateId(), date: now, qty: restoreQty, type: 'in' as const, notes: `استرجاع بسبب حذف طلب: ${d.name}` }; logAction('inventory', invItem.id, 'RESTORE', `استرجاع ${restoreQty} بسبب حذف طلب ${d.name}`); return { ...invItem, qty: newQty, movements: [...(invItem.movements || []), movement] }; })); } } else if (orderToDelete.type === 'internet_card') { const c = internetCards.find(x => x.id === orderToDelete.itemId); if (c && c.inventoryItemId) { setInventoryItems(prevItems => prevItems.map(invItem => { if (invItem.id !== c.inventoryItemId) return invItem; const deductionPerUnit = c.deductionAmount || 1; const restoreQty = orderToDelete.quantity * deductionPerUnit; const newQty = (invItem.qty || 0) + restoreQty; const movement = { id: generateId(), date: now, qty: restoreQty, type: 'in' as const, notes: `استرجاع بطاقة: ${c.name} عند حذف طلب` }; logAction('inventory', invItem.id, 'RESTORE', `استرجاع ${restoreQty} بطاقة ${c.name} بسبب حذف الطلب`); return { ...invItem, qty: newQty, movements: [...(invItem.movements || []), movement] }; })); } } } if ('durationMinutes' in target) { const record = target as Record; const updatedOrders = record.orders.filter(o => o.id !== orderId); const fins = calcRecordFinancials(record, record.endTime, pricingConfig, updatedOrders, record.discountApplied); const oldTotalInvoice = record.totalInvoice; const newTotalInvoice = fins.totalInvoice || 0; const diffAmount = oldTotalInvoice - newTotalInvoice; const u = getPerformer(); const dateKey = getLocalDate(); setRecords(prev => prev.map(r => { if (r.id !== target.id) return r; const paid = r.paidTotal || 0; const rem = Math.max(0, newTotalInvoice - paid); const isNowPaid = rem < 0.5; return { ...r, ...fins, orders: updatedOrders, totalInvoice: newTotalInvoice, remainingDebt: rem, isPaid: isNowPaid, paymentStatus: isNowPaid ? 'paid' : 'customer_debt' }; })); if (diffAmount > 0) { const customer = customers.find(c => c.phone === record.customerPhone); const isFullyPaid = record.isPaid; if (isFullyPaid) { if (customer) { setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, creditBalance: c.creditBalance + diffAmount } : c)); } } else { if (customer) { setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, debtBalance: Math.max(0, c.debtBalance - diffAmount) } : c)); } const entry = createEntry(TransactionType.DEBT_PAYMENT, diffAmount, 'in', 'receivable', `تصحيح دين: حذف طلب من فاتورة ${record.customerName}`, undefined, record.id, undefined, dateKey, undefined, undefined, u.performedById, u.performedByName); setLedger(prev => [entry, ...prev]); } } } else { setSessions(prev => prev.map(s => s.id === target.id ? { ...s, orders: s.orders.filter(o => o.id !== orderId) } : s)); } showToast('تم حذف الطلب وتحديث الحسابات'); };
    const handleUpdateProfile = async () => { if (!profileData.name || !profileData.username) { showToast('الاسم واسم المستخدم مطلوبان', 'error'); return; } const updated = { ...currentUser!, name: profileData.name, username: profileData.username, password: profileData.password || undefined }; await updateUser(updated); setModals(prev => ({ ...prev, profile: false })); logAction('user', currentUser!.id, 'UPDATE_PROFILE', 'قام المستخدم بتحديث بيانات ملفه الشخصي'); showToast('تم تحديث الملف الشخصي'); };
    const calculatedOpsExpense = useMemo(() => {
        if (!inventoryPreview) return 0;

        return (inventoryPreview.electricityCost || 0) +
            savingPlans.filter(p => p.category === 'expense' && p.isActive).reduce((sum, p) => {
                const daysInMonth = getDaysInMonth(inventoryRange.start);
                const dailyRate = p.amount / daysInMonth;
                const pStart = p.lastAppliedAt > inventoryRange.start ? p.lastAppliedAt : inventoryRange.start;
                const diffTime = new Date(inventoryRange.end).getTime() - new Date(pStart).getTime();
                let days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (pStart === inventoryRange.end) days = 1;

                return sum + (dailyRate * Math.max(0, days));
            }, 0);
    }, [inventoryPreview, savingPlans, inventoryRange]);

    const handleDeleteSession = (sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);
        if (!session) return;

        // Restore Stock logic
        const now = new Date().toISOString();
        if (session.orders && session.orders.length > 0) {
             const updates: {itemId: string, qty: number, note: string}[] = [];
             session.orders.forEach(order => {
                 if (order.type === 'drink') {
                     const d = drinks.find(x => x.id === order.itemId);
                     if (d && d.components) {
                         d.components.forEach(comp => {
                             updates.push({ 
                                 itemId: comp.itemId, 
                                 qty: comp.qty * order.quantity, 
                                 note: `استرجاع (حذف جلسة): ${d.name}` 
                             });
                         });
                     }
                 } else if (order.type === 'internet_card') {
                     const c = internetCards.find(x => x.id === order.itemId);
                     if (c && c.inventoryItemId) {
                         const deduction = c.deductionAmount || 1;
                         updates.push({ 
                             itemId: c.inventoryItemId, 
                             qty: order.quantity * deduction, 
                             note: `استرجاع (حذف جلسة): ${c.name}` 
                         });
                     }
                 }
             });

             if (updates.length > 0) {
                 setInventoryItems(prev => prev.map(invItem => {
                     const myUpdates = updates.filter(u => u.itemId === invItem.id);
                     if (myUpdates.length === 0) return invItem;
                     
                     const totalRestore = myUpdates.reduce((s, u) => s + u.qty, 0);
                     const movements = myUpdates.map(u => ({
                         id: generateId(),
                         date: now,
                         qty: u.qty,
                         type: 'in' as const,
                         notes: u.note
                     }));
                     
                     return {
                         ...invItem,
                         qty: (invItem.qty || 0) + totalRestore,
                         movements: [...(invItem.movements || []), ...movements]
                     };
                 }));
                 updates.forEach(u => logAction('inventory', u.itemId, 'RESTORE', u.note));
             }
        }

        setSessions(prev => prev.filter(s => s.id !== sessionId));
        logAction('session', sessionId, 'DELETE_SESSION', `حذف الجلسة: ${session.customerName}`);
        showToast('تم حذف الجلسة بنجاح');
    };

    return (
        <Layout
            activeView={activeView}
            onNavigate={setActiveView}
            isMobileMenuOpen={isMobileMenuOpen}
            setIsMobileMenuOpen={setIsMobileMenuOpen}
            daysSinceBackup={daysSinceBackup}
            currentUser={currentUser}
            onLogout={logout}
            onEditProfile={() => {
                setProfileData({ name: currentUser!.name, username: currentUser!.username, password: '' });
                setModals(prev => ({ ...prev, profile: true }));
            }}
        >
            {/* ... (Standard Layout components) */}
            {toast && <Toast msg={toast.msg} type={toast.type} />}

            {integrityErrors.length > 0 && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 animate-pulse-slow">
                    <AlertTriangle className="text-red-600 shrink-0 mt-1" size={24} />
                    <div>
                        <h3 className="text-red-800 font-bold text-lg">تنبيه: مشاكل في سلامة البيانات</h3>
                        <ul className="list-disc list-inside text-sm text-red-700 mt-1">{integrityErrors.map((err, i) => <li key={i}>{err}</li>)}</ul>
                    </div>
                </div>
            )}

            {periodLock && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-800 text-sm font-bold"><Lock size={16} /> <span>النظام مغلق للعمليات قبل: {periodLock.lockedUntil}</span></div>
                    {currentUser!.role === 'admin' && <button onClick={() => setPeriodLock(null)} className="text-xs text-amber-600 underline">فتح القفل (Admin)</button>}
                </div>
            )}

            {activeView === 'dashboard' && <Dashboard
                sessions={sessions}
                records={records}
                dayCycles={dayCycles}
                onAddCustomer={() => { setCustomerSearch(''); setNewSessionData({ name: '', phone: '', time: getCurrentTimeOnly(), device: 'mobile', notes: '', isVIP: false }); setModals(prev => ({ ...prev, addSession: true })); }}
                onEditSession={handleEditSession}
                onDeleteSession={handleDeleteSession}
                onCheckout={(targetSessions) => { 
                    // Select default primary: VIP first, or first session
                    const defaultPrimary = targetSessions.find(s => {
                        const cust = customers.find(c => c.phone === s.customerPhone);
                        return cust?.isVIP;
                    }) || targetSessions[0];
                    
                    setCheckoutData({ sessions: targetSessions, primarySessionId: defaultPrimary?.id || null, time: getCurrentTimeOnly(), cash: '', bank: '', bankAccountId: '', senderPhone: targetSessions[0]?.customerPhone || '', senderAccountName: targetSessions[0]?.customerName || '', excuse: '', discount: undefined }); 
                    setModals({ ...modals, checkout: true }); 
                }}
                onAddDrink={(s) => { setOrderData({ target: s, orderIdToEdit: null, type: 'drink', itemId: '', size: 'small', qty: '1', time: getCurrentTimeOnly(), lockType: true }); setModals(m => ({ ...m, addOrder: true })); }}
                onAddCard={(s) => { setOrderData({ target: s, orderIdToEdit: null, type: 'internet_card', itemId: '', size: 'small', qty: '1', time: getCurrentTimeOnly(), lockType: true }); setModals(m => ({ ...m, addOrder: true })); }}
                onEditOrder={handleEditOrder}
                onDeleteOrder={(s, oid) => handleDeleteOrder(s, oid)}
                onDeviceChange={handleDeviceChange}
                onUndoEvent={handleUndoEvent}
                onNavigate={setActiveView}
                systemState={systemState}
                onStartNewDay={onStartNewDay}
                onCloseDay={onCloseDayAction}
                onInventory={onInventoryAction}
                customers={customers}
                pricingConfig={pricingConfig}
                onViewAudit={() => setModals(m => ({ ...m, audit: true }))}
                ledger={ledger}
                currentUser={currentUser}
                inventoryItems={inventoryItems}
            />}

            {activeView === 'partners' && <PartnersPage snapshots={inventorySnapshots} purchases={purchases} debts={debtsList} placeLoans={placeLoans} cashTransfers={cashTransfers} ledger={ledger} />}
            {activeView === 'liabilities' && (
                <LiabilitiesPage
                    loans={placeLoans} onUpdateLoans={setPlaceLoans} onAddLoan={handleAddPlaceLoan} onPayInstallment={handlePayLoanInstallment}
                    expenses={expenses} onUpdateExpenses={setExpenses} onAddExpense={handleAddExpense} onDeleteExpense={handleDeleteExpense}
                    savingPlans={savingPlans} onUpdateSavingPlans={setSavingPlans} onManualSaving={handleManualSaving} onDeleteSavingPlan={handleDeleteSavingPlan}
                    savingGoals={savingGoals} onUpdateSavingGoals={setSavingGoals}
                    ledger={ledger} onUpdateLedger={setLedger}
                    bankAccounts={bankAccounts} purchases={purchases} onUpdatePurchases={setPurchases} onAddPurchase={handleAddPurchase} onDeletePurchase={handleDeletePurchase}
                    inventoryItems={inventoryItems} setInventoryItems={setInventoryItems}
                />
            )}

            {activeView === 'records' && (
                <RecordsList
                    records={records}
                    dailyClosings={dailyClosings}
                    bankAccounts={bankAccounts}
                    onRepayDebt={handleRepayDebt}
                    systemState={systemState}
                    onStartNewDay={onStartNewDay}
                    onEditOrder={handleEditOrder}
                    onDeleteOrder={(r, oid) => handleDeleteOrder(r, oid)}
                    onCloseDay={onCloseDayAction}
                    onRevertTransaction={handleRevertTransaction}
                    customers={customers}
                />
            )}
            {activeView === 'cost_analysis' && <CostAnalysis dayCycles={dayCycles} systemState={systemState} onInventory={onInventoryAction} ledger={ledger} records={records} />}
            {activeView === 'treasury' && (
                <TreasuryPage
                    records={records} accounts={bankAccounts} onUpdateAccounts={setBankAccounts} cashTransfers={cashTransfers} onUpdateCashTransfers={setCashTransfers}
                    expenses={expenses} purchases={purchases} debtsList={debtsList} pricingConfig={pricingConfig} placeLoans={placeLoans} systemState={systemState} onAddTransfer={handleAddCashTransfer} ledger={ledger} onUpdateLedger={setLedger}
                    savingPlans={savingPlans} // Pass savingPlans
                />
            )}
            {/* ... rest of components ... */}
            {activeView === 'vip_customers' && <VipCustomersPage customers={customers} onUpdateCustomers={setCustomers} />}
            {activeView === 'drinks' && <DrinksPage drinks={drinks} onAdd={d => setDrinks([...drinks, d])} onUpdate={d => setDrinks(drinks.map(x => x.id === d.id ? d : x))} onDelete={id => setDrinks(drinks.filter(d => d.id !== id))} inventoryItems={inventoryItems} />}
            {activeView === 'inventory' && (
                <InventoryPage
                    inventoryItems={inventoryItems}
                    setInventoryItems={setInventoryItems}
                    logAction={logAction}
                    currentUser={currentUser}
                    ledger={ledger}
                    setLedger={setLedger}
                    bankAccounts={bankAccounts}
                />
            )}
            {activeView === 'internet_cards' && <InternetCardsPage cards={internetCards} onAdd={c => setInternetCards([...internetCards, c])} onUpdate={c => setInternetCards(internetCards.map(x => x.id === c.id ? c : x))} onDelete={id => setInternetCards(internetCards.filter(c => c.id !== id))} />}
            {activeView === 'partner_debts' && <PartnerDebtsPage debtsList={debtsList} onUpdateDebtsList={setDebtsList} bankAccounts={bankAccounts} onAddDebt={handleAddPartnerDebt} onDeleteDebt={handleDeletePartnerDebt} />}
            {activeView === 'profit_dist' && <ProfitDistribution records={records} purchases={purchases} debtsList={debtsList} expenses={expenses} pricingConfig={pricingConfig} placeLoans={placeLoans} ledger={ledger} />}
            {activeView === 'inventory_archive' && (
                <InventoryArchive snapshots={inventorySnapshots} onUpdateSnapshots={setInventorySnapshots} records={records} expenses={expenses} purchases={purchases} debtsList={debtsList} pricingConfig={pricingConfig} placeLoans={placeLoans} onDelete={(id) => setInventorySnapshots(inventorySnapshots.filter(s => s.id !== id))} systemState={systemState} ledger={ledger} />
            )}
            {activeView === 'settings' && <Settings pricingConfig={pricingConfig} onUpdatePricing={setPricingConfig} />}
            {activeView === 'ledger_viewer' && <LedgerViewerPage ledger={ledger} />}
            {activeView === 'audit_log' && <AuditLogPage logs={auditLogs} />}
            {activeView === 'backup_restore' && <BackupRestorePage onBackupComplete={handleBackupComplete} />}

            {activeView === 'users' && currentUser!.role === 'admin' && (
                <UsersPage users={users} onAddUser={addUser} onUpdateUser={updateUser} onDeleteUser={deleteUser} currentUser={currentUser!} />
            )}

            {/* Modals ... */}
            <Modal isOpen={modals.addSession} onClose={() => { setModals(prev => ({ ...prev, addSession: false })); setEditingSessionId(null); }} title={editingSessionId ? "تعديل بيانات الجلسة" : "جلسة جديدة"} description={editingSessionId ? "تعديل تفاصيل الجلسة الحالية" : "تسجيل دخول زبون جديد"}>
                {/* ... existing modal content */}
                <div className="space-y-4">
                    {systemState.currentDate !== getLocalDate() && (
                        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm font-bold flex items-center gap-2 mb-2 border border-red-200">
                            <AlertTriangle size={20} className="shrink-0 animate-pulse" />
                            <span>تنبيه: الدورة الحالية بتاريخ قديم ({systemState.currentDate}). يرجى إغلاق اليوم!</span>
                        </div>
                    )}
                    <div className="relative mb-2">
                        <div className="relative">
                            <Search className="absolute right-3 top-3 text-gray-400" size={16} />
                            <input type="text" placeholder="بحث عن زبون مسجل (اسم أو جوال)..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} className="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 pr-10 text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                        </div>
                        {filteredCustomers.length > 0 && (
                            <div className="absolute z-20 w-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 max-h-40 overflow-y-auto">
                                {filteredCustomers.map(c => (
                                    <div key={c.id} onClick={() => { setNewSessionData(prev => ({ ...prev, name: c.name, phone: c.phone, isVIP: c.isVIP, notes: c.notes || '' })); setCustomerSearch(''); }} className="p-3 hover:bg-indigo-50 cursor-pointer border-b border-gray-50 last:border-0 flex justify-between items-center">
                                        <div><div className="font-bold text-sm text-gray-800">{c.name}</div><div className="text-xs text-gray-500">{c.phone}</div></div>
                                        {c.isVIP && <Star size={14} className="text-yellow-500 fill-yellow-500" />}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <FormInput label="اسم الزبون" placeholder="الاسم" value={newSessionData.name} onChange={e => setNewSessionData({ ...newSessionData, name: e.target.value })} />
                    <FormInput label="رقم الجوال" type="tel" placeholder="05xxxxxxxx" value={newSessionData.phone} onChange={e => setNewSessionData({ ...newSessionData, phone: e.target.value })} />
                    <FormInput label="وقت الدخول" type="time" value={newSessionData.time} onChange={e => setNewSessionData({ ...newSessionData, time: e.target.value })} />
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <label className="block text-sm font-bold text-gray-800 mb-2">نوع الجهاز</label>
                        <div className="flex gap-2">
                            <button onClick={() => setNewSessionData({ ...newSessionData, device: 'mobile' })} className={`flex-1 py-2 text-sm font-bold rounded ${newSessionData.device === 'mobile' ? 'bg-blue-600 text-white' : 'bg-white border text-gray-600'}`}>جوال فقط</button>
                            <button onClick={() => setNewSessionData({ ...newSessionData, device: 'laptop' })} className={`flex-1 py-2 text-sm font-bold rounded ${newSessionData.device === 'laptop' ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-600'}`}>لابتوب</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 cursor-pointer" onClick={() => setNewSessionData({ ...newSessionData, isVIP: !newSessionData.isVIP })}>
                        <input type="checkbox" checked={newSessionData.isVIP} onChange={() => { }} className="w-5 h-5 accent-indigo-600" />
                        <span className="text-sm font-bold text-gray-800">زبون مميز (VIP)</span>
                    </div>
                    <FormInput label="ملاحظات" placeholder="اختياري" value={newSessionData.notes} onChange={e => setNewSessionData({ ...newSessionData, notes: e.target.value })} />
                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="secondary" onClick={() => { setModals(prev => ({ ...prev, addSession: false })); setEditingSessionId(null); }}>إلغاء</Button>
                        <Button onClick={handleStartSession}>{editingSessionId ? "حفظ التعديلات" : "بدء الجلسة"}</Button>
                    </div>
                </div>
            </Modal>

            {/* ... Other modals (checkout, addOrder, endDay, audit) remain the same ... */}
            <Modal isOpen={modals.checkout} onClose={() => setModals({ ...modals, checkout: false })} title={checkoutData.sessions.length > 1 ? "إغلاق حساب جماعي" : "إغلاق الحساب"} description="تفاصيل الفاتورة والدفع">
                {checkoutFinancials && (
                    <div className="space-y-6">
                        
                        {/* Group Selection Summary */}
                        {checkoutData.sessions.length > 1 && (
                            <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="p-2 bg-indigo-200 rounded-lg text-indigo-700"><Users size={20}/></div>
                                    <div className="flex-1">
                                        <h4 className="font-bold text-indigo-900 text-sm">دفع موحد لـ {checkoutData.sessions.length} أشخاص</h4>
                                        <p className="text-[10px] text-indigo-600 font-bold">حدد الشخص المسؤول عن الفاتورة (المميز):</p>
                                    </div>
                                </div>
                                <div className="space-y-2 max-h-32 overflow-y-auto">
                                    {checkoutData.sessions.map(s => {
                                        const isSelected = checkoutData.primarySessionId === s.id;
                                        return (
                                            <div 
                                                key={s.id} 
                                                onClick={() => setCheckoutData(prev => ({ ...prev, primarySessionId: s.id }))}
                                                className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all ${isSelected ? 'bg-white border-indigo-500 shadow-sm' : 'bg-indigo-50/50 border-transparent hover:bg-white/50'}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    {isSelected ? <CheckCircle size={16} className="text-indigo-600" /> : <Circle size={16} className="text-indigo-300" />}
                                                    <span className={`text-xs font-bold ${isSelected ? 'text-indigo-900' : 'text-indigo-700'}`}>{s.customerName}</span>
                                                </div>
                                                <span className="text-[10px] font-mono text-indigo-400">{formatCurrency(checkoutFinancials.individualResults.find(r => r.session.id === s.id)?.financials.totalInvoice || 0)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                            {checkoutData.sessions.length === 1 && (
                                <div className="flex justify-between items-center mb-2 px-2">
                                    <h3 className="font-bold text-gray-900">{checkoutData.sessions[0].customerName}</h3>
                                    <span className="text-sm font-bold bg-white px-2 py-1 rounded border">{formatDuration(checkoutFinancials.aggregatedStats.totalDuration)}</span>
                                </div>
                            )}
                            
                            {checkoutData.sessions.length === 1 && checkoutData.sessions[0].events && checkoutData.sessions[0].events.length > 0 && (
                                <div className="mb-4 bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
                                    <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1"><ArrowRightLeft size={12} /> سجل التنقلات</p>
                                    <div className="space-y-2 text-xs relative before:absolute before:right-1.5 before:top-1 before:bottom-1 before:w-0.5 before:bg-gray-100">
                                        <div className="relative pr-4 flex justify-between items-center text-gray-500"><span className="absolute right-0 top-1 w-3 h-3 bg-gray-200 rounded-full border-2 border-white"></span><span>بداية الجلسة ({checkoutData.sessions[0].events[0].fromDevice === 'mobile' ? 'جوال' : 'لابتوب'})</span><span className="font-mono">{new Date(checkoutData.sessions[0].startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span></div>
                                        {checkoutData.sessions[0].events.map((e, idx) => (
                                            <div key={e.id} className="relative pr-4 flex justify-between items-center font-medium text-gray-800"><span className="absolute right-0 top-1 w-3 h-3 bg-indigo-500 rounded-full border-2 border-white"></span><span>تحويل إلى {e.toDevice === 'mobile' ? 'جوال' : 'لابتوب'}</span><span className="font-mono">{new Date(e.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span></div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2 text-sm bg-white p-3 rounded-lg border border-gray-100">
                                <div className="flex justify-between"><span className="text-gray-600">الجلسات (الوقت)</span><span className="font-bold">{formatCurrency(checkoutFinancials.aggregatedStats.totalSessionCost)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-600">الطلبات</span><span className="font-bold">{formatCurrency(checkoutFinancials.aggregatedStats.totalDrinksCost + checkoutFinancials.aggregatedStats.totalCardsCost)}</span></div>
                                
                                {/* Discount Input (Visible for both Single and Group) */}
                                <div className="pt-2 border-t border-dashed mt-2">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
                                            <Coins size={12} /> {checkoutData.sessions.length > 1 ? 'خصم جماعي (يوزع بالنسب)' : 'مبلغ الخصم (اختياري)'}
                                        </span>
                                        {checkoutData.discount && (
                                            <button onClick={() => setCheckoutData({ ...checkoutData, discount: undefined })} className="text-[10px] text-red-500 underline">إلغاء الخصم</button>
                                        )}
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            placeholder="0.00"
                                            value={checkoutData.discount?.value || ''}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value);
                                                if (val > 0) {
                                                    setCheckoutData({ ...checkoutData, discount: { type: 'fixed', value: val, amount: val, locked: false } });
                                                } else {
                                                    setCheckoutData({ ...checkoutData, discount: undefined });
                                                }
                                            }}
                                            className="block w-full pr-10 pl-3 py-2 border border-gray-200 rounded-xl bg-gray-50 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-sm font-bold"
                                        />
                                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
                                            <span className="text-xs font-bold">₪</span>
                                        </div>
                                    </div>
                                    
                                    {checkoutFinancials.totalDiscountApplied > 0 && (
                                        <div className="flex justify-between text-red-600 font-bold mt-2 bg-red-50 px-2 py-1 rounded">
                                            <span>إجمالي الخصم المطبق</span>
                                            <span>-{formatCurrency(checkoutFinancials.totalDiscountApplied)}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="pt-2 border-t border-gray-200 flex justify-between text-lg font-bold text-indigo-700"><span>الإجمالي المستحق</span><span>{formatCurrency(checkoutFinancials.grandTotalDue || 0)}</span></div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <FormInput label="وقت الخروج" type="time" value={checkoutData.time} onChange={e => setCheckoutData({ ...checkoutData, time: e.target.value })} />
                            
                            <div className="grid grid-cols-2 gap-4"><FormInput label="مدفوع نقدي (كاش)" type="number" unit="₪" value={checkoutData.cash} onChange={e => setCheckoutData({ ...checkoutData, cash: e.target.value })} placeholder="0" /><FormInput label="مدفوع بنكي" type="number" unit="₪" value={checkoutData.bank} onChange={e => setCheckoutData({ ...checkoutData, bank: e.target.value })} placeholder="0" /></div>
                            
                            {parseFloat(checkoutData.bank) > 0 && (
                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 animate-fade-in">
                                    <FormInput as="select" label="البنك المستلم (إلى)" value={checkoutData.bankAccountId} onChange={e => setCheckoutData({ ...checkoutData, bankAccountId: e.target.value })} className="mb-2" error={!checkoutData.bankAccountId ? 'مطلوب' : ''}><option value="">-- اختر الحساب --</option>{bankAccounts.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</FormInput>
                                    <FormInput label="رقم جوال المرسل" value={checkoutData.senderPhone} onChange={e => setCheckoutData({ ...checkoutData, senderPhone: e.target.value })} className="mb-2" error={!checkoutData.senderPhone ? 'مطلوب' : ''} />
                                    <FormInput label="اسم حساب المرسل" value={checkoutData.senderAccountName} onChange={e => setCheckoutData({ ...checkoutData, senderAccountName: e.target.value })} error={!checkoutData.senderAccountName ? 'مطلوب' : ''} />
                                </div>
                            )}
                            
                            <FormInput label="ملاحظات / سبب الدين" value={checkoutData.excuse} onChange={e => setCheckoutData({ ...checkoutData, excuse: e.target.value })} placeholder="اختياري..." />
                        </div>
                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                            <Button variant="secondary" onClick={() => setModals({ ...modals, checkout: false })}>إلغاء</Button>
                            <Button onClick={handleCompleteCheckout} disabled={!canSubmitCheckout}>تأكيد وحفظ</Button>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal isOpen={modals.addOrder} onClose={() => setModals(prev => ({ ...prev, addOrder: false }))} title={orderData.orderIdToEdit ? "تعديل طلب" : "إضافة طلب"}>
                {/* ... existing modal content ... */}
                <div className="space-y-4">
                    {!orderData.lockType && (
                        <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
                            <button onClick={() => setOrderData({ ...orderData, type: 'drink', itemId: '', size: 'small' })} className={`flex-1 py-2 text-xs font-bold rounded ${orderData.type === 'drink' ? 'bg-white shadow text-indigo-700' : 'text-gray-500'}`}>مشروبات</button>
                            <button onClick={() => setOrderData({ ...orderData, type: 'internet_card', itemId: '' })} className={`flex-1 py-2 text-xs font-bold rounded ${orderData.type === 'internet_card' ? 'bg-white shadow text-blue-700' : 'text-gray-500'}`}>بطاقات نت</button>
                        </div>
                    )}
                    {orderData.type === 'drink' ? (
                        <>
                            <FormInput as="select" label="المشروب" value={orderData.itemId} onChange={e => { const d = drinks.find(x => x.id === e.target.value); setOrderData({ ...orderData, itemId: e.target.value, size: d?.availability === 'large' ? 'large' : 'small' }); }}>
                                <option value="">-- اختر --</option>
                                {drinks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </FormInput>
                            {orderData.itemId && (
                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                    <label className="block text-sm font-bold text-gray-800 mb-2">الأحجام المتاحة</label>
                                    <div className="flex gap-2">
                                        {(() => {
                                            const d = drinks.find(x => x.id === orderData.itemId);
                                            if (!d) return null;
                                            return (
                                                <>
                                                    {(d.availability === 'small' || d.availability === 'both') && <button onClick={() => setOrderData({ ...orderData, size: 'small' })} className={`flex-1 py-2 text-xs font-bold rounded ${orderData.size === 'small' ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-600'}`}>صغير ({formatCurrency(d.smallPrice || 0)})</button>}
                                                    {(d.availability === 'large' || d.availability === 'both') && <button onClick={() => setOrderData({ ...orderData, size: 'large' })} className={`flex-1 py-2 text-xs font-bold rounded ${orderData.size === 'large' ? 'bg-orange-600 text-white' : 'bg-white border text-gray-600'}`}>كبير ({formatCurrency(d.largePrice || 0)})</button>}
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <FormInput as="select" label="نوع البطاقة" value={orderData.itemId} onChange={e => setOrderData({ ...orderData, itemId: e.target.value })}>
                            <option value="">-- اختر --</option>
                            {internetCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </FormInput>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <FormInput label="الكمية" type="number" min="1" value={orderData.qty} onChange={e => setOrderData({ ...orderData, qty: e.target.value })} />
                        <FormInput label="الوقت" type="time" value={orderData.time} onChange={e => setOrderData({ ...orderData, time: e.target.value })} />
                    </div>

                    {orderModalStockStatus && (
                        <div className="mt-2 bg-gray-50 p-4 rounded-2xl border border-gray-200 animate-slide-up">
                            <h5 className="text-[10px] font-black text-gray-400 uppercase mb-3 tracking-widest flex items-center gap-2">
                                <Box size={14} /> فحص المكونات والمخزون
                            </h5>
                            <div className="space-y-2">
                                {orderModalStockStatus.map((status, i) => (
                                    <div key={i} className="flex justify-between items-center text-xs">
                                        <span className="font-bold text-gray-700">{status.name}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-400">تحتاج: {Math.floor(status.needed * 1000) / 1000} {status.unit}</span>
                                            <span className={`px-2 py-0.5 rounded-full font-black text-[10px] ${status.isShort ? 'bg-red-600 text-white shadow-sm' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                                                {status.isShort ? `ناقص (${Math.floor(status.available * 100) / 100})` : `متوفر (${Math.floor(status.available * 100) / 100})`}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                                {orderModalStockStatus.some(s => s.isShort) && (
                                    <div className="flex items-start gap-2 mt-3 p-3 bg-red-50 rounded-xl border border-red-100 text-[11px] text-red-800 font-black">
                                        <AlertTriangle size={18} className="shrink-0 text-red-600 animate-pulse" />
                                        <span>نظام المنع مفعل: لا يمكن إضافة الطلب لوجود نقص في المخزون. يرجى توريد البضاعة أولاً.</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="secondary" onClick={() => setModals(prev => ({ ...prev, addOrder: false }))}>إلغاء</Button>
                        <Button onClick={handleSaveOrder} disabled={!canSaveOrder} className={`${!canSaveOrder ? 'bg-gray-300' : (orderData.type === 'drink' ? 'bg-indigo-600' : 'bg-blue-600')}`}>
                            {canSaveOrder ? 'حفظ الطلب' : 'ممنوع (نقص مخزون)'}
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={modals.endDay} onClose={() => setModals({ ...modals, endDay: false })} title="إغلاق اليوم (الدورة الحالية)" description="ملخص الدورة (محسوب من السجل المالي)">
                {endDayData && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4"><div className="bg-emerald-50 p-3 rounded border border-emerald-100 text-center"><span className="block text-xs text-gray-500">إجمالي الإيراد</span><span className="block text-xl font-bold text-emerald-700">{formatCurrency(endDayData.totalRevenue)}</span></div><div className="bg-red-50 p-3 rounded border border-red-100 text-center"><span className="block text-xs text-gray-500">إجمالي الديون</span><span className="block text-xl font-bold text-red-700">{formatCurrency(endDayData.totalDebt)}</span></div></div>
                        <div className="space-y-2 text-sm bg-gray-50 p-3 rounded border border-gray-100">
                            <div className="flex justify-between"><span>كاش في الصندوق</span><span className="font-bold">{formatCurrency(endDayData.cashRevenue)}</span></div>
                            <div className="flex justify-between"><span>تحويلات بنكية</span><span className="font-bold">{formatCurrency(endDayData.bankRevenue)}</span></div>
                            <div className="border-t border-gray-200 my-1 pt-1"></div>
                            <div className="flex justify-between"><span>عدد السجلات (تقريبي)</span><span className="font-bold">{endDayData.recordCount}</span></div>
                            <div className="flex justify-between text-xs text-gray-500"><span>صافي الكاش (بعد المصاريف)</span><span className="font-mono">{formatCurrency(endDayData.netCashFlow)}</span></div>
                        </div>
                        <FormInput label="ملاحظات الإغلاق" as="textarea" value={endDayNotes} onChange={e => setEndDayNotes(e.target.value)} placeholder="أي ملاحظات حول الدورة..." />
                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                            <Button variant="secondary" onClick={() => setModals({ ...modals, endDay: false })}>إلغاء</Button>
                            <Button className="bg-red-600 hover:bg-red-700" onClick={handleConfirmEndDay}>تأكيد الإغلاق</Button>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal isOpen={modals.audit} onClose={() => setModals(prev => ({ ...prev, audit: false }))} title="سجل العمليات (Audit Log)">
                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                    {auditLogs.length === 0 ? <p className="text-center text-gray-400">لا يوجد سجلات</p> : auditLogs.map(log => (<div key={log.id} className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-sm"><div className="flex justify-between text-xs text-gray-500 mb-1"><span>{new Date(log.timestamp).toLocaleString('ar-SA')}</span><span className="uppercase font-bold tracking-wider">{log.action}</span></div><div className="font-medium text-gray-800">{log.details}</div><div className="flex justify-between text-xs text-gray-400 mt-1"><span>ID: {log.entityId}</span><span>{log.performedByName}</span></div></div>))}
                </div>
                <div className="flex justify-end pt-4"><Button onClick={() => setModals(prev => ({ ...prev, audit: false }))}>إغلاق</Button></div>
            </Modal>

            <Modal isOpen={modals.inventory} onClose={() => setModals({ ...modals, inventory: false })} title="الجرد النهائي والأرشفة" description="مراجعة شاملة للأداء المالي قبل قفل الفترة">
                {inventoryPreview && (
                    <div className="space-y-6 animate-fade-in">

                        {/* Liquidity & Reconciliation Section */}
                        <div className="bg-white p-5 rounded-[28px] border border-gray-200 shadow-sm relative overflow-hidden">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <div className="bg-indigo-600 text-white p-2 rounded-xl"><Wallet size={20} /></div>
                                    <h4 className="font-black text-indigo-900 text-lg">الموقف المالي (السيولة)</h4>
                                </div>
                                <div className="text-left">
                                    <p className="text-[10px] text-gray-400 font-bold uppercase">إجمالي المتوفر (كاش + بنك)</p>
                                    <p className="text-2xl font-black text-indigo-600">{formatCurrency(inventoryPreview.netCashInPlace + inventoryPreview.netBankInPlace)}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Cash Section */}
                                <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100">
                                    <div className="flex items-center gap-2 mb-2 text-emerald-700 font-bold border-b border-gray-200 pb-2">
                                        <Banknote size={16} /> <span>الصندوق (الكاش)</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-gray-500">الصافي المحاسبي</span>
                                        <span className="font-black text-gray-800">{formatCurrency(inventoryPreview.netCashInPlace)}</span>
                                    </div>

                                    <div className="flex justify-between items-center pt-2 mt-2 border-t border-dashed border-gray-200">
                                        <span className="text-indigo-900 font-bold text-xs">الكاش في الدرج (دون خصم)</span>
                                        <span className="text-lg font-black text-indigo-600">{formatCurrency(inventoryPreview.netCashInPlace)}</span>
                                    </div>
                                </div>

                                {/* Bank Section */}
                                <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100 h-fit">
                                    <div className="flex items-center gap-2 mb-2 text-blue-700 font-bold border-b border-gray-200 pb-2">
                                        <Landmark size={16} /> <span>البنك (الأرصدة)</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-gray-500">الصافي المحاسبي</span>
                                        <span className="font-black text-gray-800">{formatCurrency(inventoryPreview.netBankInPlace)}</span>
                                    </div>

                                    <div className="flex justify-between items-center pt-2 mt-2 border-t border-dashed border-gray-200">
                                        <span className="text-indigo-900 font-bold text-xs">الرصيد الفعلي</span>
                                        <span className="text-lg font-black text-indigo-600">{formatCurrency(inventoryPreview.netBankInPlace)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* --- Deductions Breakdown (Informational Only) --- */}
                        <div className="bg-white p-4 rounded-2xl border border-gray-200">
                            <h4 className="font-black text-gray-800 mb-3 border-b border-gray-100 pb-2 flex items-center gap-2">
                                <MinusCircle size={16} className="text-rose-500" />
                                تفاصيل الخصومات من الإيراد (للعلم فقط)
                            </h4>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600 font-bold">تكلفة البضاعة المباعة (COGS)</span>
                                    <span className="font-black text-amber-600">{formatCurrency(inventoryPreview.totalCOGS)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600 font-bold">المصاريف التشغيلية (التزامات شهرية + كهرباء)</span>
                                    <span className="font-black text-rose-600">
                                        {formatCurrency(calculatedOpsExpense)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-xs text-gray-400 pr-4">
                                    <span>↳ منها كهرباء ({parseFloat(currentMeterReading) || 0})</span>
                                    <span>{formatCurrency(inventoryPreview.electricityCost)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600 font-bold">الدفعات المستحقة (ديون وقروض)</span>
                                    <span className="font-black text-blue-600">{formatCurrency(inventoryPreview.totalLoanRepayments || 0)}</span>
                                </div>
                                <div className="border-t border-dashed pt-2 mt-2 flex justify-between items-center">
                                    <span className="text-gray-600 font-bold">اقتطاع الصندوق التطويري ({pricingConfig.devPercent}%)</span>
                                    <span className="font-black text-indigo-600">{formatCurrency(inventoryPreview.devCut)}</span>
                                </div>
                                <div className="bg-gray-50 p-2 rounded-lg flex justify-between items-center font-black mt-2 text-gray-800">
                                    <span>إجمالي المخصوم (نظرياً)</span>
                                    <span>
                                        {formatCurrency(
                                            (inventoryPreview.totalCOGS || 0) +
                                            calculatedOpsExpense +
                                            (inventoryPreview.totalLoanRepayments || 0) +
                                            (inventoryPreview.devCut || 0)
                                        )}
                                    </span>
                                </div>
                            </div>
                        </div>
                        {/* ---------------------------------- */}

                        <div className="bg-indigo-600 p-6 rounded-[32px] text-white shadow-xl shadow-indigo-100 text-center relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10"><Zap size={100} fill="currentColor" /></div>
                            <p className="text-xs font-black text-indigo-100 uppercase mb-2 tracking-widest">صافي الربح (بعد خصم التكاليف نظرياً)</p>
                            <p className="text-5xl font-black tracking-tight">{formatCurrency(inventoryPreview.netCashInPlace + inventoryPreview.netBankInPlace-(inventoryPreview.totalCOGS || 0) -
                                            calculatedOpsExpense -
                                            (inventoryPreview.totalLoanRepayments || 0))}</p>
                            <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-2 text-xs font-bold">
                                <div><p className="opacity-70">نسبة التطوير ({pricingConfig.devPercent}%)</p><p className="text-sm font-black">-{formatCurrency(inventoryPreview.devCut)}</p></div>
                                <div><p className="opacity-70">الصافي بعد الخصم</p><p className="text-sm font-black">{formatCurrency(inventoryPreview.netCashInPlace + inventoryPreview.netBankInPlace-(inventoryPreview.totalCOGS || 0) -
                                            calculatedOpsExpense -
                                            (inventoryPreview.totalLoanRepayments || 0)-(inventoryPreview.devCut || 0))}</p></div>
                            </div>
                        </div>

                        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200">
                            <div className="flex items-center justify-between mb-4 border-b border-gray-200 pb-3">
                                <h4 className="font-bold text-gray-800 flex items-center gap-2"><Zap size={16} className="text-amber-500" /> استهلاك الكهرباء</h4>
                                <span className="text-[10px] font-bold text-gray-400">القراءة السابقة: {pricingConfig.lastMeterReading} kWh</span>
                            </div>
                            <div className="flex gap-4 items-center">
                                <div className="flex-1">
                                    <FormInput label="قراءة العداد الحالية" type="number" value={currentMeterReading} onChange={e => setCurrentMeterReading(e.target.value)} className="mb-0" />
                                </div>
                                <div className="text-left pt-6">
                                    <p className="text-[10px] text-gray-400 font-bold">التكلفة المحسوبة</p>
                                    <p className="font-black text-rose-600">{formatCurrency(inventoryPreview.electricityCost)}</p>
                                </div>
                            </div>
                            <div className="mt-2 text-[10px] text-gray-500 bg-white p-2 rounded border border-gray-200">
                                ملاحظة: سيتم تحديث قراءة العداد، ولكن لن يتم خصم المبلغ من الصندوق تلقائياً.
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                            <Button variant="secondary" onClick={() => setModals({ ...modals, inventory: false })} className="rounded-xl px-6">إلغاء</Button>
                            <Button className="bg-indigo-600 px-10 rounded-xl font-black shadow-lg shadow-indigo-100" onClick={() => setModals(prev => ({ ...prev, inventoryConfirm: true }))} disabled={!currentMeterReading || parseFloat(currentMeterReading) < pricingConfig.lastMeterReading}>
                                تأكيد الأرشفة وقفل الفترة
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal isOpen={modals.inventoryConfirm} onClose={() => setModals(prev => ({ ...prev, inventoryConfirm: false }))} title="تأكيد نهائي لعملية الجرد">
                <div className="space-y-6">
                    <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100 flex items-start gap-4 animate-pulse-slow">
                        <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600"><Info size={24} /></div>
                        <div>
                            <h4 className="font-black text-indigo-900">تنبيه هام</h4>
                            <p className="text-xs text-indigo-700 font-bold leading-relaxed">
                                أنت على وشك أرشفة الفترة المالية. سيتم حفظ التقرير وتحديث عداد الكهرباء، ولكن لن يتم خصم أي مبالغ (كهرباء أو ادخار) من رصيد الصندوق الفعلي.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={() => handleArchiveInventory()}
                            className="w-full p-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-right shadow-lg shadow-emerald-100 transition-all flex items-center justify-between group"
                        >
                            <div>
                                <p className="font-black text-lg">نعم، أرشفة وإغلاق الفترة</p>
                                <p className="text-[10px] text-emerald-50 opacity-80 font-bold">حفظ التقرير وتحديث العدادات فقط (بدون خصم مالي)</p>
                            </div>
                            <CheckCircle size={24} className="group-hover:scale-110 transition-transform" />
                        </button>

                        <button
                            onClick={() => setModals(prev => ({ ...prev, inventoryConfirm: false }))}
                            className="w-full p-4 bg-gray-50 hover:bg-gray-100 text-gray-500 rounded-2xl text-center font-black text-sm transition-all"
                        >
                            إلغاء والرجوع
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={modals.profile} onClose={() => setModals(prev => ({ ...prev, profile: false }))} title="تعديل الملف الشخصي">
                <div className="space-y-4">
                    <FormInput label="الاسم الكامل" value={profileData.name} onChange={e => setProfileData({ ...profileData, name: e.target.value })} />
                    <FormInput label="اسم المستخدم" value={profileData.username} onChange={e => setProfileData({ ...profileData, username: e.target.value })} />
                    <FormInput label="كلمة المرور الجديدة" value={profileData.password} onChange={e => setProfileData({ ...profileData, password: e.target.value })} placeholder="اتركه فارغاً للإبقاء على القديمة" />
                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <Button variant="secondary" onClick={() => setModals(prev => ({ ...prev, profile: false }))}>إلغاء</Button>
                        <Button onClick={handleUpdateProfile}><CheckCircle size={18} className="ml-2" /> حفظ التغييرات</Button>
                    </div>
                </div>
            </Modal>
        </Layout>
    );
};

export default App;
