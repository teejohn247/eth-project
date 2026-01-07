import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '@env/environment';
import { CredoPaymentService } from '@shared/services/credo-payment.service';
import { NotificationService } from '@shared/services/notification.service';
import { SharedService } from '@shared/services/shared.service';
import { UtilityService } from '@shared/services/utility.service';
import { BehaviorSubject, catchError, debounceTime, distinctUntilChanged, map, merge, Observable, of, Subject, switchMap, tap } from 'rxjs';

@Component({
  selector: 'app-voting',
  templateUrl: './voting.component.html',
  styleUrls: ['./voting.component.scss']
})
export class VotingComponent implements OnInit {

  contestants: any[] = [];
  searchTerm = '';
  private searchTerm$ = new BehaviorSubject<string>('');
  private refresh$ = new Subject<void>();
  searchLoading = false;
  evictedContestants = [
    "CNT-003",
    "CNT-004",
    "CNT-005",
    "CNT-006",
    "CNT-007",
    "CNT-011",
    "CNT-013",
    "CNT-016",
    "CNT-017",
    "CNT-021",
    "CNT-022",
    "CNT-023",
    "CNT-024",
    "CNT-025",
    "CNT-027",
    "CNT-028",
    "CNT-038",
    "CNT-039",
    "CNT-040",
    "CNT-041",
    "CNT-044"
  ]

  // the filtered list driven by backend
  filteredContestants$: Observable<any[]> = of([]);

  /** The contestant currently being voted for */
  activeVote: number | null = null;

  /** Number of votes being purchased */
  voteCount: number = 0;

  /** voteCount × 100 */
  totalAmount: number = 0;

  isLoading: boolean = false;
  today = new Date();
  cutoffDate = new Date('2025-12-13T11:00:00');
  envProd:boolean = environment.production;

  constructor(
    private utilityService: UtilityService,
    private sharedService: SharedService,
    private paymentService: CredoPaymentService,
    private notifyService: NotificationService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadContestants();
    this.listenForVoteCompletion();

    // wire up search -> backend stream
    // this.filteredContestants$ = merge(
    //   this.searchTerm$,
    //   this.refresh$.pipe(map(() => this.searchTerm)) // use current search value
    // ).pipe(
    //   debounceTime(300),
    //   tap(() => this.searchLoading = true),
    //   switchMap(search =>
    //     this.sharedService.getAllContestants(search).pipe(
    //       map(res => {
    //         // adapt to your backend shape (res.data or res.data.contestants)
    //         // prefer res.data.contestants if available, fall back to res.data
    //         const data = res?.data?.contestants ?? res?.data ?? [];
    //         return data;
    //       }),
    //       catchError(err => {
    //         this.notifyService.showError('Could not load contestants. Please try again.');
    //         return of([]);
    //       })
    //     )
    //   ),
    //   tap(() => this.searchLoading = false)
    // );

    // wire up search -> backend stream
    this.filteredContestants$ = merge(
      this.searchTerm$,
      this.refresh$.pipe(map(() => this.searchTerm))
    ).pipe(
      debounceTime(300),
      tap(() => (this.searchLoading = true)),
      switchMap(search =>
        this.sharedService.getAllContestants(search).pipe(
          map(res => {
            const data = res?.data?.contestants ?? res?.data ?? [];

            // Fast lookup for evicted contestants
            const evictedSet = new Set(this.evictedContestants);

            return data
              // 1. Add isEvicted flag
              .map((contestant:any) => ({
                ...contestant,
                isEvicted: evictedSet.has(contestant.contestantNumber)
              }))
              // 3. Prevent search if contestant is evicted
              .filter((contestant:any) => !contestant.isEvicted || !search)
              // 2. Order: non-evicted first, evicted last
              .sort((a:any, b:any) => Number(a.isEvicted) - Number(b.isEvicted));
          }),
          catchError(err => {
            this.notifyService.showError('Could not load contestants. Please try again.');
            return of([]);
          })
        )
      ),
      tap(() => (this.searchLoading = false))
    );


    // trigger initial load (empty search)
    this.searchTerm$.next('');
  }

  /** Listen for updates from the payment service */
  private listenForVoteCompletion() {
    this.paymentService.votePayment$.subscribe(res => {
      if (res.status === 'success') {
        this.notifyService.showSuccess('Vote successful!');
        this.cancelVoting();
        this.refresh$.next();
        this.isLoading = false;
        window.location.reload();
      }
      else if (res.status === 'failed') {
        //this.notifyService.showError('Vote payment failed. Please try again.');
        this.cancelVoting();
        this.refresh$.next();
        this.isLoading = false;
        window.location.reload();
      }
    });
  }

  /** Get contestants list from backend */
  loadContestants() {
    this.sharedService.getAllContestants().subscribe({
      next: res => this.contestants = res.data.contestants,
      error: () => this.notifyService.showError('Could not load contestants.')
    });
  }

  onSearchChange(event: Event) {
    const value = (event.target as HTMLInputElement).value ?? '';
    this.searchTerm = value;
    this.searchTerm$.next(value.trim());
  }

  clearSearch() {
    this.searchTerm = '';
    this.searchTerm$.next('');
  }

  /** Fallback background for missing images */
  getBackgroundImage(c: any) {
    return c.profilePhoto
      ? `url('${c.profilePhoto.url}')`
      : `linear-gradient(to bottom, #444, #000)`;
  }

  /** When the "Vote" button is clicked */
  startVoting(contestant: any) {
    this.activeVote = contestant._id;
    this.voteCount = 0;
    this.totalAmount = 0;
  }

  updateVotesFromAmount() {
    if (this.totalAmount < 100 || this.totalAmount % 100 !== 0) {
      this.voteCount = 0;
      return;
    }
    this.voteCount = this.totalAmount / 100;
  }

  cancelVoting() {
    this.activeVote = null;
    this.voteCount = 0;
    this.totalAmount = 0;
    this.isLoading = false;
  }

  /** Build payment metadata */
  private buildMetadata(contestant: any) {
    return {
      type: 'vote_payment',
      contestantId: contestant._id,
      contestantVoteCode: contestant.contestantNumber,
      contestantName: `${contestant.firstName} ${contestant.lastName}`,
      talent: contestant.talentCategory,
      votesPurchased: this.voteCount,
      amountPaid: this.totalAmount
    };
  }

  /** Start vote payment using the payment service */
  makeVotePayment(contestant: any) {
    if (this.totalAmount < 100 || this.totalAmount % 100 !== 0) {
      this.notifyService.showError('Enter a valid amount. Minimum is ₦100 and must be in multiples of 100.');
      return;
    }

    this.isLoading = true;
    const metadata = this.buildMetadata(contestant);

    const customer = {
      firstName: contestant.firstName,
      lastName: contestant.lastName,
      email: contestant.email,
      phone: contestant.phone || ''
    };

    this.paymentService.startPayment(
      customer,
      this.totalAmount,
      metadata,
      window.location.origin
    );
  }

  contactForm() {
    this.utilityService.contactForm();
  }

  goToLogin() {
    this.router.navigate(['/login'], { queryParams: { action: 'login' } });
  }

  goToRegister() {
    this.router.navigate(['/login'], { queryParams: { action: 'create' } });
  }
}
