import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { Providers } from '@microsoft/mgt';
import { EventBusService, Events } from '../core/eventbus.service';
import { FeatureFlagsService } from '../core/feature-flags.service';
import { Phone } from '../shared/interfaces';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit {

  @Output() userLoggedIn = new EventEmitter();
  callVisible = false;
  callData = {} as Phone;
  subscriptions: Subscription[] = [];

  constructor(private eventBus: EventBusService, public featureFlags: FeatureFlagsService) { }

  ngOnInit() {
    this.subscriptions.push(
      this.eventBus.on(Events.CustomerCall, (data: Phone) => {
        this.callVisible = true;
        this.callData = data;
      })
    );
  }

  async loginCompleted() {
    const me = await Providers.globalProvider.graph.client.api('me').get();
    this.userLoggedIn.emit(me);
  }

  hangup() {
    this.callVisible = false;
  }

  ngOnDestroy() {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

}
