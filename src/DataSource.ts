import defaults from 'lodash/defaults';

import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  CircularDataFrame,
  FieldType,
  LoadingState,
  //toDataFrame
} from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Observable, merge } from 'rxjs';

import { MyQuery, MyDataSourceOptions, defaultQuery } from './types';

export class DataSource extends DataSourceApi<MyQuery, MyDataSourceOptions> {
  serverURL: string;

  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);

    this.serverURL = instanceSettings.jsonData.url || 'ws://localhost:8181';

    

  }

  query(options: DataQueryRequest<MyQuery>): Observable<DataQueryResponse> {
    const observables = options.targets.map(target => {
      const query = defaults(target, defaultQuery);
      return new Observable<DataQueryResponse>(subscriber => {
        query.timeoutS = parseFloat(getTemplateSrv().replace(query.timeoutS.toString(), options.scopedVars))
        query.server = getTemplateSrv().replace(query.server, options.scopedVars)
        query.capacity =  parseFloat(getTemplateSrv().replace(query.capacity.toString(), options.scopedVars))
        const frame = new CircularDataFrame({
          append: 'tail',
          capacity: query.capacity || 1000,
        });

        console.log(frame);

        const timeout = query.timeoutS > 0 ? query.timeoutS * 1000 / 2 : 0;//PingSend = ServerTimeout / 2
        let server = "wss://10.140.133.144/api/realtime/live?db=global&signal=" + query.server || this.serverURL;
        const connection = new WebSocket(server);
        let interval: NodeJS.Timeout;
        frame.refId = query.refId;

        connection.onerror = (error: any) => {
          console.error(`WebSocket error: ${JSON.stringify(error)}`);
          clearInterval(interval);
          //throw new Error("Can't connect to " + this.serverURL);
        };

        connection.onmessage = (event: any) => {
          let jsonData = JSON.parse(event.data);
          console.log(jsonData);
          let finalData = jsonData[query.server ? query.server : 0]

          //console.log(jsonData['VPP.Connect::Model.wind[1].longitude.value'].value);

               
          if (frame.fields.length <= 1) {
            //first time initalize the keys from the json data
            Object.keys(finalData).forEach(function (k) {
              if (k === "timestamp") {
                frame.addField({ name: k, type: FieldType.time });
              } else if(k === "value") {
                frame.addField({ name: k, type: FieldType.number });
              }else if(k === "name") {
                frame.addField({ name: k, type: FieldType.name });
              }

            });
          };
          

          frame.add(finalData);
          //console.log(Object.values([Object.values(frame.fields[0].values)])[0][0][0]['value']);
       
          // let data: any = [];
          // data.push(Object.values(frame.fields[0].values)[0]);
          //console.log(test);
          //console.log(Object.values(frame.fields[0].values));
          //console.log(Object.values(frame.fields[0].values)[0][0]['value']);
          subscriber.next({
            //data:  [toDataFrame(frame.fields)],
            //data:  [Object.values(frame.fields[0].values)],
            data: [frame],
            key: query.refId,
            state: LoadingState.Streaming,
          });
        };

        connection.onclose = (ev: CloseEvent) => {
          console.log("WebSocket closed: " + ev.reason)
          clearInterval(interval);
        }

        if (timeout > 0) {
          console.log("Ping Timeout: " + timeout);
          interval = setInterval(function ping() {
            if (connection.readyState === 1) {
              connection.send("ping");
            }
            else if (connection.readyState > 1) {
              clearInterval(interval);
            }
          }, timeout);
        }


        return () => {
          connection.close(1000, "Dashboard closed");
        }


      });
    });
    console.log(...observables);
    return merge(...observables);
  }


  async testDatasource() {
    // TODO: Implement a health check for your data source.
    return {
      status: 'success',
      message: 'Data source tests - Success',
    };
  }
}
